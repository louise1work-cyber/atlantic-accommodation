/**
 * Reader for an inbound .ics feed — the other half of lib/ical.js.
 *
 * lib/ical.js WRITES our direct bookings out for Airbnb to import. This file
 * READS Airbnb's own export back in, so this site knows which dates Airbnb has
 * already taken. Without it the site has no idea a guest is enquiring about a
 * week that was booked on Airbnb three days ago.
 *
 * Airbnb's export gives all-day VEVENTs and nothing else useful: no guest, no
 * rate, and a blocked date looks identical whether it's a real reservation or a
 * manual block. Dates are all we take, and all we need.
 */

// Africa/Johannesburg, not UTC — at 01:00 SAST the UTC date is still yesterday,
// and "is this range in the past" should follow the calendar the guest is on.
function todayInSA() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

// RFC 5545 §3.1: a CRLF followed by a space or tab continues the previous line.
// Airbnb folds long UID lines, so unfolding first is not optional.
function unfold(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

// "20260904" or "20260904T140000Z" -> "2026-09-04". Anything else -> null.
function parseIcalDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(value || "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ISO date + n days, staying in plain-date arithmetic (no timezone drift).
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Parse an .ics document into blocked ranges.
 *
 * Returns [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }] where `to` is EXCLUSIVE —
 * the checkout day, matching the DTEND semantics lib/ical.js already writes.
 * A guest checking out on the 5th frees the night of the 5th.
 */
function parseCalendar(text) {
  const ranges = [];
  const body = unfold(text);

  // Split on VEVENT boundaries rather than regexing the whole document, so a
  // property inside one event can't be matched against another's dates.
  const events = body.split(/BEGIN:VEVENT/i).slice(1);

  for (const event of events) {
    const block = event.split(/END:VEVENT/i)[0];
    const startMatch = /^DTSTART[^:\r\n]*:(.+)$/im.exec(block);
    const endMatch = /^DTEND[^:\r\n]*:(.+)$/im.exec(block);
    if (!startMatch) continue;

    const from = parseIcalDate(startMatch[1]);
    if (!from) continue;

    // A VEVENT with no DTEND is a single day; treat it as one blocked night.
    let to = endMatch ? parseIcalDate(endMatch[1]) : null;
    if (!to) to = addDays(from, 1);

    // Guard against a malformed feed producing an inverted or empty range,
    // which would otherwise merge into its neighbours and block real dates.
    if (to <= from) to = addDays(from, 1);

    ranges.push({ from, to });
  }

  return ranges;
}

/**
 * Sort, drop anything already past, and merge overlapping or touching ranges.
 *
 * Touching ranges are merged deliberately: a checkout on the 5th followed by a
 * check-in on the 5th is a turnover day, not a free night, so [1,5) and [5,9)
 * become [1,9).
 */
function normaliseRanges(ranges, fromDate) {
  const cutoff = fromDate || todayInSA();
  const future = ranges
    .filter((r) => r.to > cutoff)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const merged = [];
  for (const range of future) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      if (range.to > last.to) last.to = range.to;
    } else {
      merged.push({ from: range.from, to: range.to });
    }
  }
  return merged;
}

/**
 * Fetch and parse one Airbnb export URL.
 *
 * Throws on network failure, timeout, or a non-200 — the caller decides how to
 * degrade, because "we couldn't reach Airbnb" must never be rendered to a guest
 * as "these dates are free".
 */
async function fetchCalendar(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "text/calendar, text/plain, */*" }
    });
    if (!res.ok) throw new Error(`Airbnb responded ${res.status}`);

    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      // Airbnb serves an HTML error page rather than a 404 when an export URL
      // has been revoked, so a 200 alone isn't proof we got a calendar.
      throw new Error("Response was not an iCalendar document");
    }
    return parseCalendar(text);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchCalendar, parseCalendar, normaliseRanges, parseIcalDate, addDays, todayInSA };
