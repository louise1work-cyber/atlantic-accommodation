/**
 * POST /api/enquiry — booking enquiry handler.
 *
 * Sends two emails via Resend:
 *   1. the enquiry to the owners, with reply-to set to the guest
 *   2. an instant branded confirmation to the guest
 * Then, best-effort, upserts the guest into Supabase and logs a timestamped
 * enquiry row against them (guest database — see lib/supabase.js). A failure
 * here never fails the request: the email is the part that must not be lost,
 * the database log is a nicety on top.
 *
 * Uses Resend's REST API over fetch so the site needs no dependencies
 * and no build step.
 *
 * Environment variables (set in Vercel):
 *   RESEND_API_KEY   required — from https://resend.com/api-keys
 *   ENQUIRY_TO       optional — defaults to info@atlanticaccommodation.co.za
 *   ENQUIRY_FROM     optional — must be on a Resend-verified domain.
 *                    Until atlanticaccommodation.co.za is verified, Resend only
 *                    allows onboarding@resend.dev.
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   optional — see lib/supabase.js.
 *                    Enquiries still send by email without these; only the
 *                    guest-database logging is skipped.
 */

const { configured: supabaseConfigured, upsertClient, createEnquiry } = require("../lib/supabase");

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TURNSTILE_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TO = process.env.ENQUIRY_TO || "info@atlanticaccommodation.co.za";
const FROM = process.env.ENQUIRY_FROM || "Atlantic Accommodation <onboarding@resend.dev>";

// Reject anything submitted faster than a human could fill the form.
const MIN_FILL_MS = 2500;

const PHONE = "+27 72 251 7390";
const SITE = "www.atlanticaccommodation.co.za";

const MAX = {
  firstName: 80,
  surname: 80,
  email: 200,
  phone: 60,
  property: 120,
  message: 4000,
  guests: 10,
  date: 30
};

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// A `type="date"` field always submits ISO; anything else isn't a date we can compare.
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

// Split an ISO date without going through Date(), which would shift the day
// across timezones — the same reason the calendar widget parses dates by hand.
const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? { y: m[1], mo: Number(m[2]), d: Number(m[3]) } : null;
};

// "6 October 2026" — long form, so a guest reading on a phone can't misread it
// as US month/day, and so it never looks like a machine value.
const longDate = (iso) => {
  const p = parts(iso);
  return p ? `${p.d} ${MONTHS[p.mo - 1]} ${p.y}` : String(iso || "");
};

/* Collapse a stay into the shortest phrase that's still unambiguous:
     same month  →  6 – 9 October 2026
     same year   →  28 October – 2 November 2026
     across NYE  →  28 December 2026 – 2 January 2027
   The en-dash is wrapped in a nowrap span at the call site so a narrow mail
   client can never break a date in half. */
function stayDates(from, to) {
  if (!isDate(from) && !isDate(to)) return "";
  if (!isDate(from)) return `until ${longDate(to)}`;
  if (!isDate(to)) return `from ${longDate(from)}`;
  const a = parts(from), b = parts(to);
  if (a.y === b.y && a.mo === b.mo) return `${a.d} – ${b.d} ${MONTHS[b.mo - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.mo - 1]} – ${b.d} ${MONTHS[b.mo - 1]} ${b.y}`;
  return `${longDate(from)} – ${longDate(to)}`;
}

// Nights, not days: check-out is the morning you leave. UTC throughout so the
// count can't drift by one across a DST boundary.
function nights(from, to) {
  const a = parts(from), b = parts(to);
  if (!a || !b) return 0;
  const utc = (p) => Date.UTC(Number(p.y), p.mo - 1, p.d);
  const diff = utc(b) - utc(a);
  return diff > 0 ? diff / 86400000 : 0;
}

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

  const range = stayDates(d.checkin, d.checkout);
  const n = nights(d.checkin, d.checkout);
  const dates = range
    ? `<span style="white-space:nowrap">${esc(range)}</span>${n ? `<span style="color:#6f6960"> &middot; ${n} night${n === 1 ? "" : "s"}</span>` : ""}`
    : "";

  return `<div style="background:#f7f5f1;padding:32px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #ded9cf">
    <div style="padding:24px 28px;border-bottom:1px solid #ded9cf">
      <div style="color:#566C65;font:500 11px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.2em">New booking enquiry</div>
      <div style="margin-top:8px;color:#2e2b26;font:400 24px/1.2 Georgia,serif">${esc(d.firstName)} ${esc(d.surname)}</div>
    </div>
    <div style="padding:20px 28px">
      <table style="border-collapse:collapse;width:100%">
        ${row("Property", esc(d.property || "No preference"))}
        ${row("Dates", dates)}
        ${row("Guests", esc(d.guests))}
        ${row("Email", `<a href="mailto:${esc(d.email)}" style="color:#566C65">${esc(d.email)}</a>`)}
        ${row("Phone", `<a href="tel:${esc(d.phone)}" style="color:#566C65">${esc(d.phone)}</a>`)}
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
      Sent from ${SITE} &middot; reply directly to answer ${esc(d.firstName || "the guest")}.
    </div>
  </div>
</div>`;
}

function guestEmail(d) {
  const first = esc(d.firstName || "there");
  const range = stayDates(d.checkin, d.checkout);
  const n = nights(d.checkin, d.checkout);

  /* The stay sits in its own panel rather than inline in a sentence: prose
     reflows at whatever width the reader's client picks, which is how the
     dates ended up split mid-value before. A table cell holds its own
     padding in Outlook too, where a styled <div> doesn't. */
  const summary =
    d.property || range
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 20px">
           <tr>
             <td style="padding:18px 20px;background:#F1F4F3;border:1px solid #dfe6e3">
               <div style="color:#566C65;font:500 11px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.16em">Your enquiry</div>
               ${d.property ? `<div style="margin-top:10px;color:#262220;font:400 19px/1.35 Georgia,serif">${esc(d.property)}</div>` : ""}
               ${
                 range
                   ? `<div style="margin-top:6px;color:#39312d;font:400 15px/1.6 -apple-system,Segoe UI,sans-serif">
                        <span style="white-space:nowrap">${esc(range)}</span>${n ? ` &middot; ${n} night${n === 1 ? "" : "s"}` : ""}
                      </div>`
                   : ""
               }
             </td>
           </tr>
         </table>`
      : "";

  return `<div style="background:#f7f5f1;padding:32px 16px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #ded9cf">
    <div style="padding:28px 32px;border-bottom:1px solid #ded9cf">
      <div style="color:#262220;font:400 26px/1.2 Georgia,serif">Atlantic Accommodation</div>
      <div style="color:#6f6960;font:500 10px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.24em;margin-top:6px">Langebaan &middot; Dolphin Beach</div>
    </div>
    <div style="padding:28px 32px;color:#262220;font:400 15px/1.7 -apple-system,Segoe UI,sans-serif">
      <p style="margin:0 0 14px">Hi ${first},</p>
      <p style="margin:0 0 20px">Thank you for your enquiry – we've received it and will come back to you personally, usually within a day.</p>
      ${summary}
      <p style="margin:0 0 14px">If it's urgent, call us on <a href="tel:+27722517390" style="color:#566C65;white-space:nowrap">${PHONE}</a>.</p>
      <p style="margin:22px 0 0;color:#6f6960">Hayley<br/>Atlantic Accommodation</p>
    </div>
    <div style="padding:16px 32px;background:#f7f5f1;border-top:1px solid #ded9cf;color:#6f6960;font:400 12px/1.5 -apple-system,Segoe UI,sans-serif">
      <a href="https://${SITE}" style="color:#566C65;text-decoration:none">${SITE}</a>
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
    firstName: clean(body.firstName, MAX.firstName),
    surname: clean(body.surname, MAX.surname),
    email: clean(body.email, MAX.email),
    phone: clean(body.phone, MAX.phone),
    property: clean(body.property, MAX.property),
    checkin: clean(body.checkin, MAX.date),
    checkout: clean(body.checkout, MAX.date),
    guests: clean(body.guests, MAX.guests),
    message: clean(body.message, MAX.message),
    // Checkboxes are only present in the POST body at all when ticked — its
    // mere presence (any value) means the guest opted in. Absent = not consented.
    marketingConsent: Boolean(body.marketingConsent)
  };

  if (!d.firstName || !d.surname || !d.email || !d.phone) {
    return res.status(400).json({ error: "Please provide your name, surname, email and phone." });
  }
  if (!isEmail(d.email)) {
    return res.status(400).json({ error: "That email address doesn't look right." });
  }
  // Check-out must come after check-in. The calendar picker can't produce an
  // inverted range, but the date fields can still be typed into directly — and
  // an enquiry logged as "9 Nov to 12 Sep" is a real thing that happened.
  // Only enforced when both are real ISO dates: anything else is left alone
  // rather than risk bouncing a genuine enquiry over a date-format quirk.
  if (isDate(d.checkin) && isDate(d.checkout) && d.checkout <= d.checkin) {
    return res.status(400).json({ error: "Your check-out date must be after your check-in date." });
  }

  // The owner notification is the one that must not be lost.
  try {
    await send(key, {
      from: FROM,
      to: [TO],
      reply_to: d.email,
      subject: `Booking enquiry – ${d.firstName} ${d.surname}${d.property ? ` – ${d.property}` : ""}`,
      html: ownerEmail(d)
    });
  } catch (err) {
    console.error("Enquiry notification failed:", err.message);
    return res.status(502).json({ error: "We couldn't send your enquiry." });
  }

  // Guest-database logging (Supabase) — best-effort. Every enquiry is logged
  // (that's the same operational record-keeping as the email above — fulfilling
  // their request), but "Marketing Consent" on the client is only ever moved to
  // true, never back to false, by upsertClient — so it's safe to pass through
  // whatever this form submission said. Never fails the request: the enquiry
  // email already delivered.
  if (supabaseConfigured()) {
    try {
      const clientId = await upsertClient({
        firstName: d.firstName,
        surname: d.surname,
        email: d.email,
        phone: d.phone,
        marketingConsent: d.marketingConsent
      });
      await createEnquiry(clientId, {
        property: d.property || undefined,
        checkin: d.checkin || undefined,
        checkout: d.checkout || undefined,
        guests: d.guests ? Number(d.guests) : undefined,
        message: d.message || undefined,
        source: "Website enquiry"
      });
    } catch (err) {
      console.error("Supabase logging failed (enquiry still delivered):", err.message);
    }
  }

  // Auto-reply is a nicety: never fail the request if it bounces.
  try {
    await send(key, {
      from: FROM,
      to: [d.email],
      reply_to: TO,
      subject: "We've received your enquiry – Atlantic Accommodation",
      html: guestEmail(d)
    });
  } catch (err) {
    console.error("Guest auto-reply failed (enquiry still delivered):", err.message);
  }

  return res.status(200).json({ ok: true });
};
