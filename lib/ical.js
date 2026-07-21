/**
 * Minimal iCalendar (.ics) builder for the "direct bookings" blocked-dates feed.
 *
 * Deliberately excludes guest details (name/email/phone) from the output — this
 * feed's URL is handed to Airbnb and Booking.com, so it should carry the same
 * information their own export feeds do: date ranges only, nothing personal.
 */

// YYYY-MM-DD -> YYYYMMDD (iCal DATE value format)
function toIcalDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ""));
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function foldLine(line) {
  // RFC 5545 §3.1: lines over 75 octets should be folded. Our lines are short
  // (dates/UIDs), so this is a no-op in practice but kept for correctness.
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += "\r\n " + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

/**
 * bookings: [{ id, checkin: 'YYYY-MM-DD', checkout: 'YYYY-MM-DD' }]
 * Returns a full VCALENDAR document as a string, or null if any booking has
 * an unparseable date (caller decides whether to skip or error).
 */
function buildCalendar(propertyName, bookings) {
  const stamp = nowStamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atlantic Accommodation//Direct Bookings//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${propertyName} — Direct Bookings`
  ];

  for (const b of bookings) {
    const start = toIcalDate(b.checkin);
    const end = toIcalDate(b.checkout);
    if (!start || !end) continue; // skip malformed rows rather than fail the whole feed
    lines.push(
      "BEGIN:VEVENT",
      foldLine(`UID:${b.id}@atlanticaccommodation.co.za`),
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`, // exclusive end — matches standard vacation-rental turnover semantics
      "SUMMARY:Not available",
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

module.exports = { buildCalendar, toIcalDate };
