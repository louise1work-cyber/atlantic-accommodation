/**
 * Shared Supabase REST client (plain fetch against PostgREST — no npm dependency,
 * matching the rest of this static site).
 *
 * Used by:
 *   api/enquiry.js          — upserts the client and logs every enquiry (timestamped)
 *   api/ical/[property].js  — reads confirmed bookings to build the calendar feed
 *   api/pay/[recordId].js   — reads one enquiry to build a PayFast payment request
 *   api/pay/webhook.js      — marks an enquiry Paid once PayFast confirms the ITN
 *   api/rates.js            — reads the optional rates table for "from R X" pricing
 *
 * Environment variables (set in Vercel):
 *   SUPABASE_URL               required — Project Settings → API → Project URL
 *   SUPABASE_SERVICE_ROLE_KEY  required — Project Settings → API → service_role secret.
 *                               This key bypasses Row Level Security entirely, which is
 *                               exactly why it must only ever live in Vercel env vars,
 *                               never in the repo or a client-side script. RLS is enabled
 *                               with no anon/authenticated policies, so this is the only
 *                               key that can read or write these tables at all.
 *
 * Schema — see README "Guest database & calendar sync" for the full table definitions.
 */

function configured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function request(path, options) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");

  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options && options.headers)
    }
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `Supabase responded ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// Find-or-update-or-create the client for this email, then return their id.
// Deliberately not a blind upsert: marketing_consent is only ever moved to true
// here, never back to false, so a later enquiry that leaves the box unticked
// can't silently erase consent already given (POPIA — consent can be withdrawn,
// but only through an explicit unsubscribe, not by omission on a later form).
async function upsertClient({ firstName, surname, email, phone, marketingConsent }) {
  const existing = await request(
    `clients?email=eq.${encodeURIComponent(email)}&select=id,marketing_consent`,
    { method: "GET" }
  );

  if (existing.length) {
    const client = existing[0];
    const patch = { first_name: firstName, surname, phone: phone || null };
    if (marketingConsent && !client.marketing_consent) {
      patch.marketing_consent = true;
      patch.consent_recorded_at = new Date().toISOString();
    }
    await request(`clients?id=eq.${client.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch)
    });
    return client.id;
  }

  const created = await request("clients", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      first_name: firstName,
      surname,
      email,
      phone: phone || null,
      marketing_consent: Boolean(marketingConsent),
      consent_recorded_at: marketingConsent ? new Date().toISOString() : null
    })
  });
  return created[0].id;
}

// One row per contact — the timestamped history behind a client (created_at
// defaults to now() in the database, so every enquiry is naturally timestamped).
async function createEnquiry(clientId, fields) {
  const created = await request("enquiries", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      client_id: clientId,
      property: fields.property || null,
      check_in: fields.checkin || null,
      check_out: fields.checkout || null,
      guests: fields.guests || null,
      message: fields.message || null,
      source: fields.source || "Website enquiry"
    })
  });
  return created[0];
}

// Confirmed bookings for one property, for the .ics feed.
async function listConfirmedBookings(property) {
  return request(
    `enquiries?property=eq.${encodeURIComponent(property)}&confirmed_booking=eq.true` +
      `&select=id,check_in,check_out,property`,
    { method: "GET" }
  );
}

// Fetch a single enquiry by id, with its client's contact details embedded —
// used to build a PayFast payment request.
async function getBooking(enquiryId) {
  const rows = await request(
    `enquiries?id=eq.${encodeURIComponent(enquiryId)}` +
      `&select=*,clients(first_name,surname,email,phone)`,
    { method: "GET" }
  );
  return rows[0] || null;
}

async function updateBooking(enquiryId, fields) {
  return request(`enquiries?id=eq.${encodeURIComponent(enquiryId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(fields)
  });
}

// Optional "from R X" pricing, one row per property. Table may be empty —
// callers must treat that as "no rates set", not an error.
async function listRates() {
  return request("rates?select=property,from_price,per", { method: "GET" });
}

module.exports = {
  configured,
  upsertClient,
  createEnquiry,
  listConfirmedBookings,
  getBooking,
  updateBooking,
  listRates
};
