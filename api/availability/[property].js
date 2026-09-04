/**
 * GET /api/availability/:property — blocked dates for one property, from every
 * channel at once.
 *
 * This is the INBOUND half of calendar sync, and the direction that actually
 * protects you day to day: api/ical/[property].js tells Airbnb about our direct
 * bookings, while this route asks Airbnb what it has already taken. Merged, the
 * two give the site one honest picture of a property's diary.
 *
 * Sources merged here:
 *   Airbnb  — that listing's export .ics, fetched fresh (URL in a Vercel env var)
 *   Direct  — Supabase enquiries with confirmed_booking = true
 *
 * Deliberately NOT fed back into api/ical/[property].js. That feed must keep
 * exporting direct bookings only — if it re-exported what it read from Airbnb,
 * Airbnb would import its own blocks back and any future channel would echo
 * dates around the loop forever.
 *
 * Fail-soft, in the same shape as api/rates.js: an unreachable Airbnb or an
 * unconfigured Supabase returns 200 with whatever sources did work, and says so
 * in `sources`. The one thing it must never do is imply a date is FREE — the
 * contract is that `blocked` is definitely taken and everything else is merely
 * "enquire", which is the site's default posture anyway.
 */

const { configured, listConfirmedBookings } = require("../../lib/supabase");
const { resolveProperty, airbnbEnvVar } = require("../../lib/properties");
const { fetchCalendar, normaliseRanges, todayInSA } = require("../../lib/airbnb-ical");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const property = resolveProperty(req.query && req.query.property);
  if (!property) {
    return res.status(404).json({ error: "Unknown property." });
  }

  const sources = { airbnb: "unconfigured", direct: "unconfigured" };
  const ranges = [];

  // --- Airbnb -------------------------------------------------------------
  const airbnbUrl = process.env[airbnbEnvVar(property.slug)];
  if (airbnbUrl) {
    try {
      const airbnbRanges = await fetchCalendar(airbnbUrl);
      ranges.push(...airbnbRanges);
      sources.airbnb = "ok";
    } catch (err) {
      // Logged, not surfaced: the URL can contain a listing token.
      console.error(`Airbnb calendar read failed for ${property.slug}:`, err.message);
      sources.airbnb = "error";
    }
  }

  // --- Direct bookings ----------------------------------------------------
  if (configured()) {
    try {
      const records = await listConfirmedBookings(property.name);
      for (const record of records) {
        if (record.check_in && record.check_out) {
          ranges.push({ from: record.check_in, to: record.check_out });
        }
      }
      sources.direct = "ok";
    } catch (err) {
      console.error(`Supabase read failed for ${property.slug}:`, err.message);
      sources.direct = "error";
    }
  }

  const blocked = normaliseRanges(ranges);

  // A failed source must not be cached for the full window, or one blip leaves
  // the site stale for 15 minutes. Successful reads get the long cache, which
  // is also what keeps us from hammering Airbnb on every page view.
  const healthy = sources.airbnb !== "error" && sources.direct !== "error";
  res.setHeader(
    "Cache-Control",
    healthy
      ? "public, max-age=900, s-maxage=900, stale-while-revalidate=3600"
      : "public, max-age=60, s-maxage=60"
  );

  return res.status(200).json({
    property: property.name,
    slug: property.slug,
    from: todayInSA(),
    blocked, // `to` is the checkout day — exclusive, so that night is free
    sources,
    updated: new Date().toISOString()
  });
};
