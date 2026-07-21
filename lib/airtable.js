/**
 * Shared Airtable REST client.
 *
 * Used by:
 *   api/enquiry.js      — logs every enquiry (best-effort, never blocks email delivery)
 *   api/ical/[property].js — reads confirmed bookings to build the calendar feed
 *
 * Environment variables (set in Vercel):
 *   AIRTABLE_API_KEY   required — a personal access token from https://airtable.com/create/tokens
 *                      needs data.records:read + data.records:write scope on the base below
 *   AIRTABLE_BASE_ID   required — from the base's API docs (starts with "app")
 *   AIRTABLE_TABLE     optional — defaults to "Bookings"
 *
 * Table schema — see README "Guest database & calendar feed" for the exact fields to create.
 */

const ENDPOINT = "https://api.airtable.com/v0";
const TABLE = process.env.AIRTABLE_TABLE || "Bookings";

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

module.exports = { configured, createRecord, listConfirmedBookings, TABLE };
