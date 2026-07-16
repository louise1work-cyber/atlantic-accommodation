/**
 * POST /api/enquiry — booking enquiry handler.
 *
 * Sends two emails via Resend:
 *   1. the enquiry to the owners, with reply-to set to the guest
 *   2. an instant branded confirmation to the guest
 *
 * Uses Resend's REST API over fetch so the site needs no dependencies
 * and no build step.
 *
 * Environment variables (set in Vercel):
 *   RESEND_API_KEY  required — from https://resend.com/api-keys
 *   ENQUIRY_TO      optional — defaults to info@atlanticaccommodation.co.za
 *   ENQUIRY_FROM    optional — must be on a Resend-verified domain.
 *                   Until atlanticaccommodation.co.za is verified, Resend only
 *                   allows onboarding@resend.dev.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TURNSTILE_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TO = process.env.ENQUIRY_TO || "info@atlanticaccommodation.co.za";
const FROM = process.env.ENQUIRY_FROM || "Atlantic Accommodation <onboarding@resend.dev>";

// Reject anything submitted faster than a human could fill the form.
const MIN_FILL_MS = 2500;

const PHONE = "+27 71 325 2574";
const SITE = "www.atlanticaccommodation.co.za";

const MAX = { name: 120, email: 200, phone: 60, property: 120, message: 4000, guests: 10, date: 30 };

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// Verify a Cloudflare Turnstile token. Returns true if the token is valid,
// throws on a hard failure so the caller can decide how to respond.
async function verifyTurnstile(secret, token, ip) {
  const params = new URLSearchParams({ secret, response: token });
  if (ip) params.append("remoteip", ip);
  const res = await fetch(TURNSTILE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const body = await res.json().catch(() => ({}));
  return body && body.success === true;
}

async function send(key, payload) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body && body.message ? body.message : `Resend responded ${res.status}`);
  return body;
}

function ownerEmail(d) {
  const row = (label, value) =>
    value
      ? `<tr>
           <td style="padding:8px 16px 8px 0;color:#6f6960;font:500 12px/1.5 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;vertical-align:top">${esc(label)}</td>
           <td style="padding:8px 0;color:#2e2b26;font:400 15px/1.6 -apple-system,Segoe UI,sans-serif">${value}</td>
         </tr>`
      : "";

  const dates =
    d.checkin || d.checkout
      ? `${esc(d.checkin || "?")} &rarr; ${esc(d.checkout || "?")}`
      : "";

  return `<div style="background:#f7f5f1;padding:32px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #ded9cf">
    <div style="padding:24px 28px;border-bottom:1px solid #ded9cf">
      <div style="color:#9a6a4a;font:500 11px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.2em">New booking enquiry</div>
      <div style="margin-top:8px;color:#2e2b26;font:400 24px/1.2 Georgia,serif">${esc(d.name)}</div>
    </div>
    <div style="padding:20px 28px">
      <table style="border-collapse:collapse;width:100%">
        ${row("Property", esc(d.property || "No preference"))}
        ${row("Dates", dates)}
        ${row("Guests", esc(d.guests))}
        ${row("Email", `<a href="mailto:${esc(d.email)}" style="color:#9a6a4a">${esc(d.email)}</a>`)}
        ${row("Phone", `<a href="tel:${esc(d.phone)}" style="color:#9a6a4a">${esc(d.phone)}</a>`)}
      </table>
      ${
        d.message
          ? `<div style="margin-top:20px;padding-top:20px;border-top:1px solid #ded9cf">
               <div style="color:#6f6960;font:500 12px/1.5 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px">Message</div>
               <div style="color:#2e2b26;font:400 15px/1.65 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${esc(d.message)}</div>
             </div>`
          : ""
      }
    </div>
    <div style="padding:16px 28px;background:#f7f5f1;border-top:1px solid #ded9cf;color:#6f6960;font:400 12px/1.5 -apple-system,Segoe UI,sans-serif">
      Sent from ${SITE} &middot; reply directly to answer ${esc(d.name.split(" ")[0] || "the guest")}.
    </div>
  </div>
</div>`;
}

function guestEmail(d) {
  const first = esc((d.name || "").split(" ")[0] || "there");
  return `<div style="background:#f7f5f1;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #ded9cf">
    <div style="padding:28px 30px;border-bottom:1px solid #ded9cf">
      <div style="color:#2e2b26;font:400 26px/1.2 Georgia,serif">Atlantic Accommodation</div>
      <div style="color:#6f6960;font:500 10px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.24em;margin-top:6px">Langebaan &middot; Dolphin Beach</div>
    </div>
    <div style="padding:28px 30px;color:#2e2b26;font:400 15px/1.7 -apple-system,Segoe UI,sans-serif">
      <p style="margin:0 0 14px">Hi ${first},</p>
      <p style="margin:0 0 14px">Thank you for your enquiry — we've received it and will come back to you personally, usually within a day.</p>
      ${
        d.property
          ? `<p style="margin:0 0 14px">You asked about <strong>${esc(d.property)}</strong>${
              d.checkin ? ` for ${esc(d.checkin)}${d.checkout ? ` to ${esc(d.checkout)}` : ""}` : ""
            }.</p>`
          : ""
      }
      <p style="margin:0 0 14px">If it's urgent, call us on <a href="tel:+27713252574" style="color:#9a6a4a">${PHONE}</a>.</p>
      <p style="margin:22px 0 0;color:#6f6960">Louise<br/>Atlantic Accommodation</p>
    </div>
    <div style="padding:16px 30px;background:#f7f5f1;border-top:1px solid #ded9cf;color:#6f6960;font:400 12px/1.5 -apple-system,Segoe UI,sans-serif">
      ${SITE} &middot; Club Mykonos, Agora Square, Langebaan, 7357
    </div>
  </div>
</div>`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("RESEND_API_KEY is not set");
    return res.status(503).json({ error: "Email is not configured yet." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid request." }); }
  }
  body = body || {};

  // --- Anti-spam layers ---

  // 1. Honeypot: bots fill this hidden field. Pretend success so they don't retry.
  if (body.botcheck) return res.status(200).json({ ok: true });

  // 2. Timing trap: a human takes time to fill the form; bots post instantly.
  //    `elapsed` is measured client-side (ms since the page loaded), so it's
  //    immune to clock skew. Absent = allowed (JS may not have run); too-fast = bot.
  var elapsed = Number(body.elapsed);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {
    return res.status(200).json({ ok: true });
  }

  // 3. Cloudflare Turnstile: only enforced once the secret is configured, so the
  //    form keeps working before setup. When on, a missing/invalid token is rejected.
  var turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (turnstileSecret) {
    var token = clean(body["cf-turnstile-response"], 4000);
    if (!token) {
      return res.status(400).json({ error: "Please complete the anti-spam check and try again." });
    }
    var headers = req.headers || {};
    var ip = headers["cf-connecting-ip"] || headers["x-forwarded-for"] || "";
    var human = false;
    try { human = await verifyTurnstile(turnstileSecret, token, String(ip).split(",")[0].trim()); }
    catch (err) { console.error("Turnstile verify error:", err.message); }
    if (!human) {
      return res.status(400).json({ error: "Anti-spam check failed. Please try again." });
    }
  }

  const d = {
    name: clean(body.name, MAX.name),
    email: clean(body.email, MAX.email),
    phone: clean(body.phone, MAX.phone),
    property: clean(body.property, MAX.property),
    checkin: clean(body.checkin, MAX.date),
    checkout: clean(body.checkout, MAX.date),
    guests: clean(body.guests, MAX.guests),
    message: clean(body.message, MAX.message)
  };

  if (!d.name || !d.email || !d.phone) {
    return res.status(400).json({ error: "Please provide your name, email and phone." });
  }
  if (!isEmail(d.email)) {
    return res.status(400).json({ error: "That email address doesn't look right." });
  }

  // The owner notification is the one that must not be lost.
  try {
    await send(key, {
      from: FROM,
      to: [TO],
      reply_to: d.email,
      subject: `Booking enquiry — ${d.name}${d.property ? ` — ${d.property}` : ""}`,
      html: ownerEmail(d)
    });
  } catch (err) {
    console.error("Enquiry notification failed:", err.message);
    return res.status(502).json({ error: "We couldn't send your enquiry." });
  }

  // Auto-reply is a nicety: never fail the request if it bounces.
  try {
    await send(key, {
      from: FROM,
      to: [d.email],
      reply_to: TO,
      subject: "We've received your enquiry — Atlantic Accommodation",
      html: guestEmail(d)
    });
  } catch (err) {
    console.error("Guest auto-reply failed (enquiry still delivered):", err.message);
  }

  return res.status(200).json({ ok: true });
};
