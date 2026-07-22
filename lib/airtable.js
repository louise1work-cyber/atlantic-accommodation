/**
 * Shared Airtable REST client.
 *
 * Used by:
 *   api/enquiry.js          — logs every enquiry (best-effort, never blocks email delivery)
 *   api/ical/[property].js  — reads confirmed bookings to build the calendar feed
 *   api/pay/[recordId].js   — reads one booking to build a PayFast payment request
 *   api/pay/webhook.js      — marks a booking Paid once PayFast confirms the ITN
 *   api/rates.js            — reads the optional Rates table for "from R X" pricing
 *
 * Environment variables (set in Vercel):
 *   AIRTABLE_API_KEY   required — a personal access token from https://airtable.com/create/tokens
 *                      needs data.records:read + data.records:write scope on the base below
 *   AIRTABLE_BASE_ID   required — from the base's API docs (starts with "app")
 *   AIRTABLE_TABLE     optional — defaults to "Bookings"
 *   AIRTABLE_RATES_TABLE  optional — defaults to "Rates"
 *
 * Table schema — see README "Guest database & calendar feed" for the exact fields to create.
 */

const ENDPOINT = "https://api.airtable.com/v0";
const TABLE = process.env.AIRTABLE_TABLE || "Bookings";
const RATES_TABLE = process.env.AIRTABLE_RATES_TABLE || "Rates";

function configured() {
  return Boolean(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID);
}

async function request(path, options) {
  const key = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!key || !baseId) throw new Error("Airtable is not configured");

  const res = await fetch(`${ENDPOINT}/${baseId}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options && options.headers)
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body && body.error && (body.error.message || body.error.type)) || `Airtable responded ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// Create one row per enquiry. Never throws past the caller without being caught —
// callers treat this as best-effort and must not let it fail the user-facing request.
async function createRecord(fields) {
  const path = `${encodeURIComponent(TABLE)}`;
  return request(path, { method: "POST", body: JSON.stringify({ fields, typecast: true }) });
}

// List confirmed bookings for one property, for the .ics feed.
// Airtable single-select values are matched exactly, so `property` must be the
// full display name (e.g. "Atlantic Crew House"), not the URL slug.
//
// Query string is built with encodeURIComponent (%20 for spaces) rather than
// URLSearchParams (which encodes spaces as "+") — deliberately, so there's no
// reliance on Airtable's query parser treating "+" as a space. A misread
// formula here wouldn't error, it would just silently match zero bookings.
async function listConfirmedBookings(property) {
  const formula = `AND({Property}="${property.replace(/"/g, '\\"')}",{Confirmed Booking}=TRUE())`;
  const baseParams =
    `filterByFormula=${encodeURIComponent(formula)}` +
    `&pageSize=100` +
    ["Check-in", "Check-out", "Property"].map((f) => `&fields[]=${encodeURIComponent(f)}`).join("");

  const records = [];
  let offset;
  do {
    const qs = offset ? `${baseParams}&offset=${encodeURIComponent(offset)}` : baseParams;
    const page = await request(`${encodeURIComponent(TABLE)}?${qs}`, { method: "GET" });
    records.push(...(page.records || []));
    offset = page.offset;
  } while (offset);

  return records;
}

// Fetch a single record by its Airtable row ID (the "rec..." ID, visible in
// Airtable's own UI/URL for that row).
async function getRecord(recordId) {
  return request(`${encodeURIComponent(TABLE)}/${encodeURIComponent(recordId)}`, { method: "GET" });
}

async function updateRecord(recordId, fields) {
  return request(`${encodeURIComponent(TABLE)}/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true })
  });
}

// List every row in the (optional, separate) Rates table — one row per property,
// each with a "From Price" and a "Per" (night/week). This table may not exist yet
// (rates are still price-on-application) — callers must treat a failure here as
// "no rates set" rather than an error, same as the rest of this client's best-effort
// reads. Rows with no positive "From Price" are skipped rather than shown as R0.
async function listRates() {
  const qs =
    `pageSize=100` +
    ["Property", "From Price", "Per"].map((f) => `&fields[]=${encodeURIComponent(f)}`).join("");

  const records = [];
  let offset;
  do {
    const path = offset ? `${encodeURIComponent(RATES_TABLE)}?${qs}&offset=${encodeURIComponent(offset)}` : `${encodeURIComponent(RATES_TABLE)}?${qs}`;
    const page = await request(path, { method: "GET" });
    records.push(...(page.records || []));
    offset = page.offset;
  } while (offset);

  return records;
}

module.exports = { configured, createRecord, listConfirmedBookings, getRecord, updateRecord, listRates, TABLE, RATES_TABLE };
