/**
 * Single source of truth for the property slug -> Supabase name mapping.
 *
 * Extracted so the two calendar routes can't drift apart: api/ical/[property].js
 * (outbound feed, direct bookings -> Airbnb/Booking.com) and
 * api/availability/[property].js (inbound feed, Airbnb + Booking.com -> this
 * site) both have to agree on exactly the same slugs and the same "property"
 * values, or one of them silently 404s.
 *
 * The names must match the Supabase `property` column exactly, which is also
 * the display text used in contact.html's property <select>.
 */

const PROPERTIES = {
  "crew-house": "Atlantic Crew House",
  "beach-cottage": "Atlantic Beach Cottage",
  apartment: "Atlantic Apartment",
  "seaview-dolphin-beach": "Atlantic Seaview Dolphin Beach"
};

// URL slug -> the Vercel env var holding that listing's Airbnb export URL.
// crew-house -> AIRBNB_ICAL_CREW_HOUSE
function airbnbEnvVar(slug) {
  return "AIRBNB_ICAL_" + String(slug).toUpperCase().replace(/-/g, "_");
}

// Same idea, for Booking.com's export URL.
// crew-house -> BOOKING_ICAL_CREW_HOUSE
function bookingEnvVar(slug) {
  return "BOOKING_ICAL_" + String(slug).toUpperCase().replace(/-/g, "_");
}

// Accepts "crew-house" or "crew-house.ics" and returns the Supabase property
// name, or null if the slug is unknown.
function resolveProperty(raw) {
  const slug = String(raw || "").trim().replace(/\.ics$/i, "");
  return PROPERTIES[slug] ? { slug, name: PROPERTIES[slug] } : null;
}

module.exports = { PROPERTIES, airbnbEnvVar, bookingEnvVar, resolveProperty };
