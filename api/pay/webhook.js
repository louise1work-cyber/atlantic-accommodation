/**
 * POST /api/pay/webhook — PayFast ITN (Instant Transaction Notification).
 *
 * This is the source of truth for "did the guest actually pay" — never the
 * return_url redirect, which a guest could reach without paying (they could
 * just navigate there manually). PayFast calls this URL server-to-server.
 *
 * Runs all four checks PayFast's own docs require before trusting an ITN —
 * skipping any of these is how a spoofed "payment successful" call becomes
 * possible:
 *   1. Signature matches (proves the payload wasn't altered in transit)
 *   2. Request actually originates from a PayFast server (not just anyone
 *      who found this URL and POSTed a fake "COMPLETE" status to it)
 *   3. The paid amount matches what we actually asked for
 *   4. PayFast's own server confirms the transaction when asked directly
 *
 * Reconstructs the signed string from the *parsed* body in PayFast's
 * documented field order (ITN_FIELD_ORDER) — this mirrors PayFast's own PHP
 * reference implementation, which also rebuilds the string from a parsed
 * $_POST array rather than raw bytes, so it isn't a shortcut.
 */

const { getBooking, updateBooking } = require("../../lib/supabase");
const {
  verifyItnSignature,
  verifyItnSource,
  verifyItnAmount,
  verifyItnWithPayfastServer,
  phpUrlEncode,
  ITN_FIELD_ORDER
} = require("../../lib/payfast");

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  return {};
}

// Rebuilds PayFast's own signed string from the parsed fields, in their
// documented order, excluding blank fields and the signature itself.
function rebuildParamString(fields) {
  return ITN_FIELD_ORDER
    .filter((k) => fields[k] !== undefined && fields[k] !== null && fields[k] !== "")
    .map((k) => `${k}=${phpUrlEncode(fields[k])}`)
    .join("&");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const passphrase = process.env.PAYFAST_PASSPHRASE;
  if (!passphrase) {
    console.error("PAYFAST_PASSPHRASE not set — cannot verify ITN, rejecting");
    return res.status(503).json({ error: "Not configured" });
  }

  const fields = parseBody(req);
  const paramString = rebuildParamString(fields);

  const headers = req.headers || {};
  const remoteIp = String(headers["x-forwarded-for"] || headers["x-real-ip"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();

  const checks = { signature: false, source: false, amount: false, serverConfirm: false };

  checks.signature = verifyItnSignature(fields, passphrase);

  try {
    checks.source = await verifyItnSource(remoteIp);
  } catch (err) {
    console.error("ITN source check failed:", err.message);
  }

  const recordId = fields.m_payment_id;
  let expectedAmount = null;
  if (recordId) {
    try {
      const record = await getBooking(recordId);
      expectedAmount = record && record.amount_due;
    } catch (err) {
      console.error("Could not look up expected amount:", err.message);
    }
  }
  checks.amount = expectedAmount != null && verifyItnAmount(expectedAmount, fields);

  try {
    checks.serverConfirm = await verifyItnWithPayfastServer(paramString);
  } catch (err) {
    console.error("PayFast server confirmation failed:", err.message);
  }

  const allPassed = checks.signature && checks.source && checks.amount && checks.serverConfirm;

  if (!allPassed) {
    console.error("ITN failed validation — not marking as paid.", {
      recordId,
      checks,
      payment_status: fields.payment_status
    });
    // Still 200: this stops PayFast retrying a payload that will never pass
    // (e.g. a forged request). A genuine PayFast outage on their side would
    // fail verifyItnWithPayfastServer too, which is the safer failure mode —
    // we'd rather investigate a stuck "Requested" row than auto-trust an
    // unconfirmed payment.
    return res.status(200).json({ received: true, verified: false });
  }

  if (fields.payment_status === "COMPLETE" && recordId) {
    try {
      await updateBooking(recordId, {
        payment_status: "Paid",
        pf_payment_id: fields.pf_payment_id || ""
      });
    } catch (err) {
      console.error("Verified payment but failed to update Supabase — needs manual follow-up:", err.message, { recordId });
    }
  }

  return res.status(200).json({ received: true, verified: true });
};
