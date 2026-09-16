/**
 * /api/admin/:action — everything behind the owner admin page (/admin).
 *
 * One function with a route per action, rather than one file each, because Vercel's
 * Hobby plan allows 12 functions per project and the site already uses six.
 *
 *   POST login         { email }               → emails a sign-in link (same reply either way)
 *   POST verify        { token }               → sets the session cookie
 *   POST logout
 *   GET  me                                    → who's signed in
 *   GET  conversation                          → the latest chat, for resuming after a reload
 *   POST chat          { conversationId?, text, photos: [{ ref, name }] }
 *   POST upload        { name, type, data }    → stores one photo (base64), returns its ref
 *   GET  requests                              → change requests for this site, newest first
 *
 * Every POST must be JSON. Together with the SameSite=Strict session cookie that
 * blocks cross-site form posts (a browser can't send a cross-origin JSON POST
 * without a CORS preflight, and this endpoint grants none).
 *
 * Environment variables: see lib/site-admin.js, lib/admin-assistant.js and
 * lib/admin-email.js, and README "Owner admin" for the full setup.
 */

const admin = require("../../lib/site-admin");
const assistant = require("../../lib/admin-assistant");
const { siteSnapshot } = require("../../lib/site-content");
const { sendLoginLink, sendChangeRequest } = require("../../lib/admin-email");
const { configured: supabaseConfigured } = require("../../lib/supabase");

const { Anthropic } = assistant;

const MAX_TEXT = 4000;
const MAX_PHOTOS_PER_MESSAGE = 6;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_CONVERSATION_CHARS = 500000;
const RESUME_WITHIN_DAYS = 14;
const PHOTO_LINK_SECONDS = 30 * 86400;
const DEFAULT_MONTHLY_CAP_USD = 20;

// Owner photos are listed on a line of their own at the end of a message, in this
// exact shape, so the assistant can cite refs and the page can redraw them on reload.
const PHOTOS_PREFIX = "[Photos attached:";
const PHOTO_ENTRY = /"([^"]*)" \(ref ([^)\s]+)\)/g;

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const cleanName = (v) => clean(v, 120).replace(/["()[\]\r\n]/g, "").trim();
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const ROUTES = {
  login: { method: "POST", handler: login },
  verify: { method: "POST", handler: verify },
  logout: { method: "POST", handler: logout },
  me: { method: "GET", handler: me, auth: true },
  conversation: { method: "GET", handler: conversation, auth: true },
  chat: { method: "POST", handler: chat, auth: true },
  upload: { method: "POST", handler: upload, auth: true },
  requests: { method: "GET", handler: requests, auth: true }
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const route = ROUTES[req.query.action];
  if (!route) return res.status(404).json({ error: "Not found." });
  if (req.method !== route.method) {
    res.setHeader("Allow", route.method);
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (route.method === "POST" && !/^application\/json\b/i.test(req.headers["content-type"] || "")) {
    return res.status(415).json({ error: "Expected JSON." });
  }
  if (!supabaseConfigured()) {
    return res.status(503).json({ error: "The admin isn't set up yet." });
  }

  try {
    let session = null;
    if (route.auth) {
      session = await admin.getSession(req);
      if (!session) return res.status(401).json({ error: "Please sign in again." });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    return await route.handler(req, res, { session, body });
  } catch (err) {
    console.error(`admin/${req.query.action} failed:`, err);
    return res.status(500).json({ error: "Something went wrong on our side. Please try again." });
  }
};

// ---- Sign-in ---------------------------------------------------------------

async function login(req, res, { body }) {
  const email = clean(body.email, 200).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });

  // The reply is identical whether or not the address has access, so this form can't
  // be used to discover which addresses do. The cost of that: a genuine delivery
  // failure also looks like success, hence the "check spam / contact us" wording on
  // the page, and the log line here.
  try {
    if (await admin.findAdmin(email)) {
      const token = await admin.createLoginToken(email);
      if (token) {
        await sendLoginLink(email, `${admin.SITE_URL}/admin/?token=${token}`, admin.LOGIN_TTL_MINUTES);
      } else {
        console.warn("admin login: hourly link cap reached for an allowed address");
      }
    }
  } catch (err) {
    console.error("admin login: could not issue link:", err.message);
  }
  return res.status(200).json({ ok: true });
}

async function verify(req, res, { body }) {
  const token = typeof body.token === "string" ? body.token : "";
  const email = /^[A-Za-z0-9_-]{43}$/.test(token) ? await admin.consumeLoginToken(token) : null;
  if (!email) {
    return res.status(400).json({ error: "This sign-in link has expired or has already been used. Request a new one below." });
  }
  res.setHeader("Set-Cookie", admin.sessionCookie(await admin.createSession(email)));
  return res.status(200).json({ ok: true });
}

async function logout(req, res) {
  await admin.revokeSession(req);
  res.setHeader("Set-Cookie", admin.clearedCookie());
  return res.status(200).json({ ok: true });
}

async function me(req, res, { session }) {
  return res.status(200).json({ email: session.email, name: session.name, assistantReady: assistant.configured() });
}

// ---- Conversation ----------------------------------------------------------

// Turn stored API messages into what the page draws: the owner's words, the
// assistant's replies, and a notice wherever a request was filed. Thinking blocks,
// tool calls and fallback markers stay server-side.
function displayItems(messages) {
  const items = [];
  for (const message of messages) {
    const blocks = typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content || [];

    if (message.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n\n").trim();
      if (text) items.push({ role: "assistant", text });
      continue;
    }

    for (const block of blocks) {
      if (block.type === "text" && block.text.startsWith(PHOTOS_PREFIX)) {
        const last = items[items.length - 1];
        const names = [...block.text.matchAll(PHOTO_ENTRY)].map((m) => m[1]);
        if (last && last.role === "owner") last.photos = names;
      } else if (block.type === "text") {
        items.push({ role: "owner", text: block.text === "(photos attached)" ? "" : block.text, photos: [] });
      } else if (block.type === "tool_result" && !block.is_error) {
        try {
          const result = JSON.parse(block.content);
          if (result.request_no) items.push({ role: "notice", text: `Request #${result.request_no} sent to Nimbus Design` });
        } catch { /* not a filing result */ }
      }
    }
  }
  return items;
}

async function conversation(req, res, { session }) {
  const latest = await admin.latestConversation(session.email);
  const fresh = latest && Date.now() - new Date(latest.updated_at).getTime() < RESUME_WITHIN_DAYS * 86400000;
  if (!fresh) return res.status(200).json({ conversationId: null, items: [] });
  return res.status(200).json({ conversationId: latest.id, items: displayItems(latest.messages || []) });
}

// Every photo the owner has attached anywhere in this conversation: ref → name.
function photosIn(messages) {
  const found = new Map();
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== "text" || !block.text.startsWith(PHOTOS_PREFIX)) continue;
      for (const m of block.text.matchAll(PHOTO_ENTRY)) found.set(m[2], m[1]);
    }
  }
  return found;
}

async function chat(req, res, { session, body }) {
  if (!assistant.configured()) {
    return res.status(503).json({ error: "The assistant isn't switched on yet. Please contact Nimbus Design." });
  }

  const text = clean(body.text, MAX_TEXT);
  const photos = (Array.isArray(body.photos) ? body.photos : [])
    .slice(0, MAX_PHOTOS_PER_MESSAGE)
    .map((p) => ({ ref: p && p.ref, name: cleanName(p && p.name) || "photo" }))
    .filter((p) => admin.objectPath(session.email, p.ref));
  if (!text && !photos.length) return res.status(400).json({ error: "Please type a message." });

  const cap = Number(process.env.ADMIN_AI_MONTHLY_CAP_USD) || DEFAULT_MONTHLY_CAP_USD;
  if ((await admin.monthSpendUsd()) >= cap) {
    return res.status(429).json({
      error: "The assistant has reached this month's usage allowance, so it's paused until the 1st. Your earlier requests are safe — for anything urgent, please email Nimbus Design."
    });
  }

  let convo;
  if (body.conversationId) {
    convo = await admin.getConversation(clean(body.conversationId, 64), session.email);
    if (!convo) return res.status(404).json({ error: "That conversation couldn't be found. Please start a new one." });
  } else {
    convo = await admin.createConversation(session.email);
  }

  const messages = Array.isArray(convo.messages) ? convo.messages.slice() : [];
  if (JSON.stringify(messages).length > MAX_CONVERSATION_CHARS) {
    return res.status(413).json({ error: "This conversation has got very long. Please tap “New request” to start a fresh one." });
  }

  const content = [{ type: "text", text: text || "(photos attached)" }];
  if (photos.length) {
    content.push({ type: "text", text: `${PHOTOS_PREFIX} ${photos.map((p) => `"${p.name}" (ref ${p.ref})`).join("; ")}]` });
  }
  messages.push({ role: "user", content });

  const knownPhotos = photosIn(messages);

  const onSubmit = async (input) => {
    // Only photos this owner actually attached in this conversation can be linked,
    // whatever refs the model passes.
    const attachments = (input.attachment_refs || [])
      .filter((ref) => knownPhotos.has(ref) && admin.objectPath(session.email, ref))
      .map((ref) => ({ ref, name: knownPhotos.get(ref), path: admin.objectPath(session.email, ref) }));

    const request = await admin.createChangeRequest({
      requested_by: session.email,
      conversation_id: convo.id,
      title: clean(input.title, 200) || "Website change",
      property: input.property === "Not property-specific" ? null : clean(input.property, 120),
      page: clean(input.page, 300) || null,
      change_type: input.change_type,
      current_content: clean(input.current_content, 8000) || null,
      requested: clean(input.requested, 8000),
      attachments,
      restricted_area: Boolean(input.restricted_area),
      developer_notes: clean(input.developer_notes, 4000) || null
    });

    // The request is saved; a failed notification mustn't make the assistant tell the
    // owner it didn't go through.
    try {
      const signed = await Promise.all(
        attachments.map(async (a) => ({ name: a.name, url: await admin.signPhoto(a.path, PHOTO_LINK_SECONDS) }))
      );
      await sendChangeRequest(request, signed);
    } catch (err) {
      console.error(`change request #${request.request_no}: notification email failed:`, err.message);
    }

    return { request_no: request.request_no, status: "received" };
  };

  let result;
  try {
    result = await assistant.runTurn({ messages, siteText: await siteSnapshot(), onSubmit });
  } catch (err) {
    if (Array.isArray(err.usage)) await recordUsage(session.email, err.usage);
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error("admin chat: Anthropic credentials rejected:", err.status, err.message);
      return res.status(503).json({ error: "The assistant isn't set up correctly. Please let Nimbus Design know." });
    }
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
      console.error("admin chat: Anthropic temporarily unavailable:", err.status, err.message);
      return res.status(503).json({ error: "The assistant is very busy right now. Please try again in a minute." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("admin chat: Anthropic request rejected:", err.status, err.message);
      return res.status(502).json({ error: "The assistant couldn't process that. Please try again, or start a new request." });
    }
    throw err;
  }

  await recordUsage(session.email, result.usage);
  if (result.messages) await admin.saveConversation(convo.id, result.messages);

  return res.status(200).json({
    conversationId: convo.id,
    reply: result.reply,
    submitted: result.submitted.map((s) => s.request_no)
  });
}

async function recordUsage(email, rows) {
  try {
    await Promise.all(rows.map((row) => admin.recordUsage({ email, ...row })));
  } catch (err) {
    console.error("admin chat: could not record AI usage:", err.message);
  }
}

// ---- Photos ----------------------------------------------------------------

const SIGNATURES = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"
};

async function upload(req, res, { session, body }) {
  const type = String(body.type || "");
  const looksRight = SIGNATURES[type];
  if (!looksRight) return res.status(400).json({ error: "Please attach a JPEG, PNG or WebP photo." });

  const data = typeof body.data === "string" ? body.data : "";
  if (data.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 4) {
    return res.status(413).json({ error: "That photo is too large. Please choose a smaller one." });
  }
  const buffer = Buffer.from(data, "base64");
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) {
    return res.status(413).json({ error: "That photo is too large. Please choose a smaller one." });
  }
  // The declared type is checked against the file's actual first bytes, so a
  // non-image can't be stored by labelling it image/jpeg.
  if (buffer.length < 12 || !looksRight(buffer)) {
    return res.status(400).json({ error: "That file doesn't look like a photo." });
  }

  const ref = await admin.uploadPhoto(session.email, buffer, type);
  return res.status(200).json({ ref, name: cleanName(body.name) || "photo" });
}

// ---- Request list ----------------------------------------------------------

async function requests(req, res) {
  const rows = await admin.listChangeRequests();
  return res.status(200).json({
    requests: rows.map((r) => ({
      number: r.request_no,
      title: r.title,
      property: r.property,
      status: r.status,
      note: r.response_note,
      photos: Array.isArray(r.attachments) ? r.attachments.length : 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  });
}
