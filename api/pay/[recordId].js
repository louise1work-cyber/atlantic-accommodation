/**
 * GET /api/pay/:recordId — generates a PayFast payment link for one confirmed booking.
 *
 * Louise's workflow: confirm a booking (README "Guest database & calendar sync"),
 * fill in "Amount Due" on that Airtable row, then send the guest this URL
 * (recordId is the row's Airtable ID, visible in Airtable's own UI/URL for that row).
 *
 * Visiting the URL renders a page that auto-redirects the guest into PayFast's
 * hosted checkout — we never see or handle card details ourselves.
 *
 * Environment variables (set in Vercel):
 *   PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY / PAYFAST_PASSPHRASE   required
 *   PAYFAST_MODE   optional — "sandbox" (default) or "live". Test a real
 *                  sandbox payment before ever switching this to "live".
 *   SITE_URL       optional — defaults to https://www.atlanticaccommodation.co.za,
 *                  used to build return/cancel/notify URLs.
 */

const { configured: airtableConfigured, getRecord, updateRecord } = require("../../lib/airtable");
const { buildPaymentFields, processUrl, mode } = require("../../lib/payfast");

const SITE_URL = process.env.SITE_URL || "https://www.atlanticaccommodation.co.za";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function errorPage(title, message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#2e2b26;text-align:center">
<h1 style="font-size:1.4rem">${esc(title)}</h1>
<p style="color:#6f6960">${esc(message)}</p>
<p><a href="tel:+27713252574">+27 71 325 2574</a> &middot; <a href="mailto:info@atlanticaccommodation.co.za">info@atlanticaccommodation.co.za</a></p>
</body></html>`;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const recordId = String((req.query && req.query.recordId) || "").trim();
  if (!/^rec[A-Za-z0-9]+$/.test(recordId)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(errorPage("Invalid link", "This payment link doesn't look right. Please ask us to resend it."));
  }

  const requiredEnv = ["PAYFAST_MERCHANT_ID", "PAYFAST_MERCHANT_KEY", "PAYFAST_PASSPHRASE"];
  if (!airtableConfigured() || requiredEnv.some((k) => !process.env[k])) {
    console.error("Payment is not fully configured (Airtable and/or PayFast env vars missing)");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(503).send(errorPage("Payments aren't set up yet", "Please contact us directly to arrange payment."));
  }

  let record;
  try {
    record = await getRecord(recordId);
  } catch (err) {
    console.error("Airtable lookup failed:", err.message);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(errorPage("Booking not found", "This payment link has expired or is incorrect. Please ask us to resend it."));
  }

  const f = record.fields || {};
  const amount = Number(f["Amount Due"]);
  const status = f["Payment Status"];

  if (status === "Paid") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(errorPage("Already paid", "This booking has already been paid for. Thank you!"));
  }
  if (!amount || amount <= 0) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(errorPage("Amount not set", "The amount for this booking hasn't been set yet. Please contact us."));
  }

  const propertyLabel = f.Property || "your stay";
  const dateRange = f["Check-in"] && f["Check-out"] ? `${f["Check-in"]} to ${f["Check-out"]}` : "";

  const fields = buildPaymentFields({
    merchantId: process.env.PAYFAST_MERCHANT_ID,
    merchantKey: process.env.PAYFAST_MERCHANT_KEY,
    passphrase: process.env.PAYFAST_PASSPHRASE,
    returnUrl: `${SITE_URL}/payment-success.html`,
    cancelUrl: `${SITE_URL}/payment-cancelled.html`,
    notifyUrl: `${SITE_URL}/api/pay/webhook`,
    nameFirst: f["First Name"],
    nameLast: f.Surname,
    email: f.Email,
    mPaymentId: recordId,
    amount,
    itemName: propertyLabel,
    itemDescription: dateRange ? `${propertyLabel} — ${dateRange}` : propertyLabel
  });

  // Best-effort: record that a payment was requested, so Airtable reflects
  // reality even if the guest never completes checkout. Never blocks the redirect.
  try {
    if (status !== "Requested") await updateRecord(recordId, { "Payment Status": "Requested" });
  } catch (err) {
    console.error("Could not mark Payment Status as Requested:", err.message);
  }

  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("\n");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Redirecting to secure payment&hellip;</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#2e2b26;text-align:center">
<p>Redirecting you to our secure payment provider&hellip;</p>
<p style="color:#6f6960;font-size:.9rem">If nothing happens, click the button below.</p>
<form id="pf" method="post" action="${esc(processUrl())}">
${inputs}
<button type="submit" style="margin-top:1rem;padding:.8rem 1.6rem;font:inherit;cursor:pointer">Continue to payment</button>
</form>
<script>document.getElementById('pf').submit();</script>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(html);
};
