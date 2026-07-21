/**
 * GET /api/ical/:property.ics — blocked-dates calendar feed for one property.
 *
 * This is the "direct bookings" side of 3-way calendar sync. Paste this URL
 * into Airbnb's and Booking.com's "import calendar" settings for the matching
 * listing, and their platforms will block these dates automatically. Their own
 * export URLs go the other way (imported into each other) — see README.
 *
 * Source of truth is Airtable: rows in the Bookings table with
 * "Confirmed Booking" ticked. Untick or delete a row to unblock those dates.
 *
 * No guest information is exposed here — see lib/ical.js.
 */

const { configured, listConfirmedBookings } = require("../../lib/airtable");
const { buildCalendar } = require("../../lib/ical");

// URL slug -> exact Airtable "Property" single-select value (must match exactly,
// same display names used in contact.html's property <select>).
const PROPERTIES = {
  "crew-house": "Atlantic Crew House",
  "beach-cottage": "Atlantic Beach Cottage",
  apartment: "Atlantic Apartment",
  "seaview-dolphin-beach": "Atlantic Seaview Dolphin Beach"
};

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const raw = String((req.query && req.query.property) || "").trim();
  const slug = raw.replace(/\.ics$/i, "");
  const propertyName = PROPERTIES[slug];

  if (!propertyName) {
    return res.status(404).json({ error: "Unknown property." });
  }

  if (!configured()) {
    console.error("Airtable is not configured (AIRTABLE_API_KEY / AIRTABLE_BASE_ID)");
    return res.status(503).json({ error: "Calendar feed is not configured yet." });
  }

  let records;
  try {
    records = await listConfirmedBookings(propertyName);
  } catch (err) {
    console.error("Airtable read failed:", err.message);
    return res.status(502).json({ error: "Could not read the calendar right now." });
  }

  const bookings = records.map((r) => ({
    id: r.id,
    checkin: r.fields && r.fields["Check-in"],
    checkout: r.fields && r.fields["Check-out"]
  }));

  const ics = buildCalendar(propertyName, bookings);

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${slug}.ics"`);
  // Airbnb/Booking.com poll every 1-24h at best, so a short edge cache just
  // spares Airtable from being hit on every request without adding real lag.
  res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");
  return res.status(200).send(ics);
};
