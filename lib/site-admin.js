/**
 * Owner admin (/admin) — data layer.
 *
 * Sign-in links, sessions, conversations, change requests, photo storage and the AI
 * spend ledger. Everything lives in the site_admin_* / site_change_requests tables
 * and the private `site-change-request-files` bucket (README "Owner admin"), reached
 * with the same service-role key as the rest of the site. RLS is on with no public
 * policies, so none of it is reachable except through these functions.
 *
 * Security model, in short:
 *   - Access is an allowlist (site_admin_users). Delete a row and that person's next
 *     request fails, even mid-session — getSession() re-checks it every time.
 *   - Sign-in links and session cookies are random 256-bit values; only their SHA-256
 *     hashes are stored, so a leaked table can't be replayed as a login.
 *   - Sign-in links are single-use, expire after 15 minutes, and are capped at 5 per
 *     hour per address so the endpoint can't be used to flood an owner's inbox.
 */

const crypto = require("crypto");
const { request } = require("./supabase");

const SITE = "atlantic-accommodation";
const SITE_URL = "https://www.atlanticaccommodation.co.za";
const BUCKET = "site-change-request-files";

const LOGIN_TTL_MINUTES = 15;
const LOGIN_LINKS_PER_HOUR = 5;
const SESSION_DAYS = 30;

// __Host- prefix: the browser refuses the cookie unless it's Secure, Path=/ and has no
// Domain — so it can never leak to another subdomain or be set over plain http.
const COOKIE = "__Host-aa_admin";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");
const eq = (value) => `eq.${encodeURIComponent(value)}`;
const nowIso = () => new Date().toISOString();
const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

// ---- Allowlist -------------------------------------------------------------

async function findAdmin(email) {
  const rows = await request(
    `site_admin_users?site=${eq(SITE)}&email=${eq(email)}&select=email,display_name`,
    { method: "GET" }
  );
  return rows[0] || null;
}

// ---- Sign-in links ---------------------------------------------------------

// Returns a fresh token, or null when this address has hit the hourly cap.
async function createLoginToken(email) {
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const recent = await request(
    `site_admin_login_tokens?site=${eq(SITE)}&email=${eq(email)}` +
      `&created_at=gte.${encodeURIComponent(hourAgo)}&select=id`,
    { method: "GET" }
  );
  if (recent.length >= LOGIN_LINKS_PER_HOUR) return null;

  const token = randomToken();
  await request("site_admin_login_tokens", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      site: SITE,
      email,
      token_hash: sha256(token),
      expires_at: inMinutes(LOGIN_TTL_MINUTES)
    })
  });
  return token;
}

// Marks the token used and returns its email, or null if it's unknown, expired or
// already spent. The used_at=is.null filter makes the claim atomic: two tabs racing
// the same link can't both win.
async function consumeLoginToken(token) {
  const claimed = await request(
    `site_admin_login_tokens?token_hash=${eq(sha256(token))}&site=${eq(SITE)}` +
      `&used_at=is.null&expires_at=gt.${encodeURIComponent(nowIso())}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ used_at: nowIso() })
    }
  );
  if (!claimed.length) return null;
  const { email } = claimed[0];
  return (await findAdmin(email)) ? email : null;
}

// ---- Sessions --------------------------------------------------------------

async function createSession(email) {
  const token = randomToken();
  await request("site_admin_sessions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      site: SITE,
      email,
      session_hash: sha256(token),
      expires_at: inMinutes(SESSION_DAYS * 24 * 60)
    })
  });
  return token;
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

// The signed-in admin for this request, or null.
async function getSession(req) {
  const token = readCookie(req);
  if (!token || token.length > 100) return null;

  const rows = await request(
    `site_admin_sessions?session_hash=${eq(sha256(token))}&site=${eq(SITE)}` +
      `&revoked_at=is.null&expires_at=gt.${encodeURIComponent(nowIso())}` +
      `&select=id,email,last_seen_at`,
    { method: "GET" }
  );
  if (!rows.length) return null;
  const session = rows[0];

  const admin = await findAdmin(session.email);
  if (!admin) return null;

  // Touch at most hourly — it's for "who's been active", not an audit trail.
  if (Date.now() - new Date(session.last_seen_at).getTime() > 3600000) {
    await request(`site_admin_sessions?id=${eq(session.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_seen_at: nowIso() })
    });
  }
  return { email: session.email, name: admin.display_name || session.email };
}

async function revokeSession(req) {
  const token = readCookie(req);
  if (!token || token.length > 100) return;
  await request(`site_admin_sessions?session_hash=${eq(sha256(token))}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: nowIso() })
  });
}

const sessionCookie = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// ---- Conversations ---------------------------------------------------------

async function getConversation(id, email) {
  const rows = await request(
    `site_admin_conversations?id=${eq(id)}&site=${eq(SITE)}&email=${eq(email)}&select=id,messages`,
    { method: "GET" }
  );
  return rows[0] || null;
}

async function latestConversation(email) {
  const rows = await request(
    `site_admin_conversations?site=${eq(SITE)}&email=${eq(email)}` +
      `&select=id,messages,updated_at&order=updated_at.desc&limit=1`,
    { method: "GET" }
  );
  return rows[0] || null;
}

async function createConversation(email) {
  const rows = await request("site_admin_conversations", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ site: SITE, email, messages: [] })
  });
  return rows[0];
}

async function saveConversation(id, messages) {
  await request(`site_admin_conversations?id=${eq(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ messages })
  });
}

// ---- Change requests -------------------------------------------------------

async function createChangeRequest(fields) {
  const rows = await request("site_change_requests", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ site: SITE, ...fields })
  });
  return rows[0];
}

async function listChangeRequests() {
  return request(
    `site_change_requests?site=${eq(SITE)}` +
      `&select=request_no,title,property,change_type,status,response_note,attachments,created_at,updated_at` +
      `&order=created_at.desc&limit=50`,
    { method: "GET" }
  );
}

// ---- AI spend ledger -------------------------------------------------------

async function recordUsage(row) {
  await request("site_admin_ai_usage", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ site: SITE, ...row })
  });
}

// Spend so far this calendar month (UTC), in US dollars.
async function monthSpendUsd() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = await request(
    `site_admin_ai_usage?site=${eq(SITE)}&created_at=gte.${encodeURIComponent(monthStart)}&select=cost_usd`,
    { method: "GET" }
  );
  return rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
}

// ---- Photo storage ---------------------------------------------------------

async function storage(path, options) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  const res = await fetch(`${url}/storage/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options && options.headers) }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!res.ok) throw new Error((body && (body.message || body.error)) || `Storage responded ${res.status}`);
  return body;
}

// Each owner's photos sit under their own folder, derived from their email — so a
// ref can only ever resolve inside the signed-in owner's folder (see objectPath).
const ownerFolder = (email) => `${SITE}/${sha256(email).slice(0, 16)}`;
const REF_PATTERN = /^\d{13}-[a-f0-9]{12}\.(jpg|png|webp)$/;
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function objectPath(email, ref) {
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) return null;
  return `${ownerFolder(email)}/${ref}`;
}

async function uploadPhoto(email, buffer, contentType) {
  const ref = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${EXT[contentType]}`;
  await storage(`object/${BUCKET}/${ownerFolder(email)}/${ref}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "x-upsert": "false" },
    body: buffer
  });
  return ref;
}

// Time-limited link to a private photo, or null if the object doesn't exist.
async function signPhoto(path, seconds) {
  try {
    const body = await storage(`object/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: seconds })
    });
    const signed = body && (body.signedURL || body.signedUrl);
    return signed ? `${process.env.SUPABASE_URL}/storage/v1${signed}` : null;
  } catch {
    return null;
  }
}

module.exports = {
  SITE,
  SITE_URL,
  LOGIN_TTL_MINUTES,
  findAdmin,
  createLoginToken,
  consumeLoginToken,
  createSession,
  getSession,
  revokeSession,
  sessionCookie,
  clearedCookie,
  getConversation,
  latestConversation,
  createConversation,
  saveConversation,
  createChangeRequest,
  listChangeRequests,
  recordUsage,
  monthSpendUsd,
  objectPath,
  uploadPhoto,
  signPhoto
};
