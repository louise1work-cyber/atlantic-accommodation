/**
 * Emails sent by the owner admin: the sign-in link, and the change-request notice to
 * Nimbus Design. Same Resend REST call and visual style as api/enquiry.js.
 *
 * Environment variables (set in Vercel):
 *   RESEND_API_KEY      required — already set for the enquiry form
 *   ENQUIRY_FROM        the verified sender, shared with the enquiry form
 *   ADMIN_NOTIFY_EMAIL  where change requests are sent. Unset = requests are still
 *                       saved to Supabase, just not emailed.
 *   ADMIN_FROM          optional — sender for admin emails. Defaults to admin@ on the
 *                       same verified domain as ENQUIRY_FROM.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = process.env.ENQUIRY_FROM || "Atlantic Accommodation <onboarding@resend.dev>";
const REPLY_TO = process.env.ENQUIRY_TO || "info@atlanticaccommodation.co.za";

/* Admin mail goes out as admin@<domain>, never as info@.
   The owners' admin address IS info@, and a sign-in link sent from info@ *to* info@
   looks to a mail server exactly like someone spoofing your own address — which is
   why Hayley's sign-in emails landed in Junk (2026-09-22) despite DKIM, SPF and DMARC
   all passing. A different mailbox on the same verified domain keeps authentication
   intact and drops the self-addressed pattern. Replies still reach info@. */
const ADMIN_FROM = (() => {
  if (process.env.ADMIN_FROM) return process.env.ADMIN_FROM;
  const domain = (/@([^\s>]+)/.exec(FROM) || [])[1];
  if (!domain || domain === "resend.dev") return FROM; // unverified fallback sender
  return `Atlantic Accommodation Admin <admin@${domain}>`;
})();

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function send(payload) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, ...payload })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body && body.message ? body.message : `Resend responded ${res.status}`);
  return body;
}

const shell = (inner) => `<div style="background:#f7f5f1;padding:32px 16px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #ded9cf">
    <div style="padding:26px 32px;border-bottom:1px solid #ded9cf">
      <div style="color:#262220;font:400 24px/1.2 Georgia,serif">Atlantic Accommodation</div>
      <div style="color:#6f6960;font:500 10px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.24em;margin-top:6px">Website admin</div>
    </div>
    <div style="padding:28px 32px;color:#262220;font:400 15px/1.7 -apple-system,Segoe UI,sans-serif">${inner}</div>
  </div>
</div>`;

async function sendLoginLink(email, url, minutes) {
  await send({
    from: ADMIN_FROM,
    to: [email],
    reply_to: REPLY_TO,
    subject: "Sign in to your Atlantic Accommodation website admin",
    // Written to read like a normal business email rather than a bare button: a
    // link-only message with no context is both what phishing looks like and what
    // spam filters score hardest.
    html: shell(`
      <p style="margin:0 0 14px">Someone asked to sign in to the Atlantic Accommodation website admin at
        <a href="https://www.atlanticaccommodation.co.za/admin/" style="color:#566C65">www.atlanticaccommodation.co.za/admin</a>,
        where you can request changes to the website.</p>
      <p style="margin:0 0 20px">If that was you, use the button below to finish signing in.</p>
      <p style="margin:0 0 20px">
        <a href="${esc(url)}" style="display:inline-block;background:#566C65;color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font:500 13px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase">Sign in</a>
      </p>
      <p style="margin:0 0 14px;font-size:13px;color:#6f6960">Or copy this address into your browser:<br/>
        <span style="word-break:break-all;color:#445550">${esc(url)}</span></p>
      <p style="margin:0 0 10px;color:#6f6960;font-size:13px">The link works once and expires in ${minutes} minutes.</p>
      <p style="margin:0;color:#6f6960;font-size:13px">If you didn't ask to sign in, you can ignore this email — nobody can get in without it. Questions? Just reply to this message.</p>`),
    text: `Someone asked to sign in to the Atlantic Accommodation website admin (www.atlanticaccommodation.co.za/admin), where you can request changes to the website.\n\nIf that was you, open this address to finish signing in:\n${url}\n\nThe link works once and expires in ${minutes} minutes.\n\nIf you didn't ask to sign in, ignore this email — nobody can get in without it.`
  });
}

const row = (label, value) =>
  value
    ? `<tr>
         <td style="padding:7px 16px 7px 0;color:#6f6960;font:500 11px/1.5 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;vertical-align:top">${esc(label)}</td>
         <td style="padding:7px 0;color:#262220;font:400 15px/1.6 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${value}</td>
       </tr>`
    : "";

// `photos` is [{ name, url }] with time-limited signed links. `updated` marks a
// corrected request, so the email says it replaces the earlier one.
async function sendChangeRequest(request, photos, { updated = false } = {}) {
  const to = process.env.ADMIN_NOTIFY_EMAIL;
  if (!to) return false;

  const photoList = photos.length
    ? photos
        .map((p) => (p.url ? `<a href="${esc(p.url)}" style="color:#566C65">${esc(p.name)}</a>` : `${esc(p.name)} (link unavailable)`))
        .join("<br/>")
    : "";

  await send({
    from: ADMIN_FROM,
    to: [to],
    reply_to: request.requested_by,
    subject: `${updated ? "Updated: " : ""}Change request #${request.request_no} – Atlantic Accommodation – ${request.title}`,
    html: shell(`
      ${request.restricted_area
        ? `<p style="margin:0 0 16px;padding:10px 14px;background:#fbf3e6;border:1px solid #ecd9b8;color:#6b4d1f;font-size:14px">Flagged as touching booking, payments, security or hosting, or a new feature — check before quoting or changing.</p>`
        : ""}
      ${updated
        ? `<p style="margin:0 0 16px;padding:10px 14px;background:#E8EDEB;border:1px solid #d3dcd8;color:#445550;font-size:14px">Corrected in the same conversation — this replaces the earlier email for request #${esc(request.request_no)}.</p>`
        : ""}
      <div style="color:#566C65;font:500 11px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.2em">Change request #${esc(request.request_no)}</div>
      <div style="margin:8px 0 18px;color:#262220;font:400 22px/1.3 Georgia,serif">${esc(request.title)}</div>
      <table style="border-collapse:collapse;width:100%">
        ${row("Property", esc(request.property))}
        ${row("Page", esc(request.page))}
        ${row("Type", esc(request.change_type))}
        ${row("Now", esc(request.current_content))}
        ${row("Change to", esc(request.requested))}
        ${row("Photos", photoList)}
        ${row("Notes", esc(request.developer_notes))}
        ${row("From", esc(request.requested_by))}
      </table>
      <p style="margin:22px 0 0;color:#6f6960;font-size:13px">Reply to this email to answer the owner directly. Photo links expire in 30 days. Track progress in Supabase → <code>site_change_requests</code>: set <code>status</code> to in_progress / done / declined, and <code>response_note</code> is shown to the owner.</p>`)
  });
  return true;
}

module.exports = { sendLoginLink, sendChangeRequest };
