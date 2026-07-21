/**
 * PayFast integration helpers.
 *
 * Reference: https://developers.payfast.co.za/docs (Custom Integration + ITN).
 * PayFast's signature scheme is PHP-urlencode-based (RFC 1738: space -> '+',
 * uppercase %XX hex, and a narrower "safe" character set than JS's
 * encodeURIComponent). Every function here that touches a signature uses
 * phpUrlEncode, never encodeURIComponent directly, or signatures silently
 * won't match for any value containing !'()*~ (e.g. a surname like "D'Angelo").
 *
 * Environment variables (set in Vercel):
 *   PAYFAST_MERCHANT_ID   required
 *   PAYFAST_MERCHANT_KEY  required
 *   PAYFAST_PASSPHRASE    required — set in PayFast dashboard Settings, must match exactly
 *   PAYFAST_MODE          optional — "sandbox" (default) or "live". Stays in
 *                         sandbox until explicitly switched, on purpose: test
 *                         a real sandbox transaction before ever taking a real one.
 */

const crypto = require("crypto");

const HOSTS = { sandbox: "sandbox.payfast.co.za", live: "www.payfast.co.za" };
// All domains PayFast's own docs list as valid sources for an ITN.
const VALID_ITN_HOSTNAMES = [
  "www.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
  "sandbox.payfast.co.za"
];

// Field order is significant for the signature (PayFast: "must be listed in
// the order in which they appear in the attributes description" — NOT
// alphabetical). These orders are copied directly from their docs.
const REQUEST_FIELD_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url",
  "name_first", "name_last", "email_address", "cell_number",
  "m_payment_id", "amount", "item_name", "item_description",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
  "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
  "email_confirmation", "confirmation_address", "payment_method"
];

const ITN_FIELD_ORDER = [
  "m_payment_id", "pf_payment_id", "payment_status", "item_name", "item_description",
  "amount_gross", "amount_fee", "amount_net",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
  "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
  "name_first", "name_last", "email_address", "merchant_id",
  "token", "billing_date"
];

function mode() {
  return process.env.PAYFAST_MODE === "live" ? "live" : "sandbox";
}

function processUrl() {
  return `https://${HOSTS[mode()]}/eng/process`;
}

function validateUrl() {
  return `https://${HOSTS[mode()]}/eng/query/validate`;
}

// PHP's urlencode(): RFC 1738 form-encoding. encodeURIComponent already
// produces uppercase %XX hex (matching PHP), but differs in two ways PHP's
// urlencode does not: it uses %20 (not '+') for space, and it leaves
// !'()*~ unescaped where PHP escapes them. Both are corrected here.
function phpUrlEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// Builds the "key=value&key=value..." string PayFast signs, in the given
// field order, skipping blank/absent fields (per their spec).
function paramString(fields, order) {
  return order
    .filter((key) => fields[key] !== undefined && fields[key] !== null && fields[key] !== "")
    .map((key) => `${key}=${phpUrlEncode(fields[key])}`)
    .join("&");
}

function signature(fields, order, passphrase) {
  let str = paramString(fields, order);
  if (passphrase) str += `&passphrase=${phpUrlEncode(passphrase)}`;
  return crypto.createHash("md5").update(str).digest("hex");
}

// Builds the full field set (with signature) for redirecting a guest to
// PayFast's hosted payment page.
function buildPaymentFields({
  merchantId, merchantKey, passphrase,
  returnUrl, cancelUrl, notifyUrl,
  nameFirst, nameLast, email,
  mPaymentId, amount, itemName, itemDescription
}) {
  const fields = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    name_first: nameFirst,
    name_last: nameLast,
    email_address: email,
    m_payment_id: mPaymentId,
    amount: Number(amount).toFixed(2),
    item_name: itemName,
    item_description: itemDescription
  };
  fields.signature = signature(fields, REQUEST_FIELD_ORDER, passphrase);
  return fields;
}

// --- ITN (webhook) verification — all four of PayFast's documented checks ---

function verifyItnSignature(itnFields, passphrase) {
  const expected = signature(itnFields, ITN_FIELD_ORDER, passphrase);
  return itnFields.signature === expected;
}

// Resolves PayFast's known hostnames and checks the connecting IP against
// them, rather than trusting a Referer header (not guaranteed present on a
// server-to-server POST, and easy to forge if it were).
async function verifyItnSource(remoteIp) {
  if (!remoteIp) return false;
  const dns = require("dns").promises;
  for (const host of VALID_ITN_HOSTNAMES) {
    try {
      const addrs = await dns.resolve4(host);
      if (addrs.includes(remoteIp)) return true;
    } catch {
      // hostname didn't resolve — try the next one
    }
  }
  return false;
}

function verifyItnAmount(expectedAmount, itnFields) {
  const diff = Math.abs(Number(expectedAmount) - Number(itnFields.amount_gross));
  return diff <= 0.01;
}

// The 4th check: replay the received data back to PayFast's own server and
// only trust it if PayFast itself confirms with the literal string "VALID".
async function verifyItnWithPayfastServer(rawBody) {
  const res = await fetch(validateUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: rawBody
  });
  const text = await res.text();
  return text.trim() === "VALID";
}

module.exports = {
  mode,
  processUrl,
  validateUrl,
  phpUrlEncode,
  buildPaymentFields,
  verifyItnSignature,
  verifyItnSource,
  verifyItnAmount,
  verifyItnWithPayfastServer,
  ITN_FIELD_ORDER,
  VALID_ITN_HOSTNAMES
};
