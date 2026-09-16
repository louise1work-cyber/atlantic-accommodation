/**
 * A plain-text snapshot of the live website, for the admin assistant's context.
 *
 * Read from the deployed pages rather than the repo, so the assistant always quotes
 * what guests actually see. The snapshot is cached per warm function instance for
 * ten minutes, and it's byte-stable between deploys — which matters: it sits in the
 * cached part of the Claude prompt, so identical bytes mean cheap cache reads on
 * every turn instead of re-paying for the whole site.
 *
 * Prices and availability load client-side from other endpoints, so they're not in
 * the HTML and won't appear here; the system prompt says so.
 */

const { SITE_URL } = require("./site-admin");

const PAGES = [
  ["Home page", "/"],
  ["All properties page", "/properties.html"],
  ["Atlantic Beach Cottage page", "/properties/beach-cottage.html"],
  ["Atlantic Apartment page", "/properties/apartment.html"],
  ["Atlantic Seaview – Dolphin Beach page", "/properties/seaview-dolphin-beach.html"],
  ["Contact & enquire page", "/contact.html"]
];

const CACHE_MS = 10 * 60 * 1000;
let cached = null;

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", middot: "·", times: "×",
  copy: "©", rarr: "→", larr: "←", bull: "•", deg: "°"
};

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? decode(m[1]) : "";
};

// Just enough HTML-to-text to keep a page's structure legible: headings, list items,
// paragraphs and — because owners say "the second photo" — every image by filename.
function pageText(html, { keepChrome = false } = {}) {
  let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];

  body = body.replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, "");
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  if (!keepChrome) {
    body = body.replace(/<header\b[^>]*class="[^"]*site-header[\s\S]*?<\/header>/i, "");
    body = body.replace(/<footer\b[\s\S]*?<\/footer>/i, "");
  }

  body = body
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "\n[embedded map]\n")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const file = attr(tag, "src").split("/").pop();
      const alt = attr(tag, "alt");
      return file ? `\n[photo: ${file}${alt ? ` — "${alt}"` : ""}]\n` : "";
    })
    .replace(/<h([1-4])\b[^>]*>/gi, (m, level) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-4]>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(label|button)\b[^>]*>/gi, " [")
    .replace(/<\/(label|button)>/gi, "] ")
    .replace(/<\/(p|div|section|ul|ol|table|tr|article|aside|figure|form|nav|dl|dd|dt)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decode(body)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, all) => line !== "[]" && !(line === "" && all[i - 1] === ""))
    .join("\n")
    .replace(/\[\s*\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchPage(path) {
  const res = await fetch(`${SITE_URL}${path}`, { headers: { "User-Agent": "AtlanticAdminAssistant/1.0" } });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.text();
}

async function siteSnapshot() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.text;

  const pages = await Promise.all(
    PAGES.map(async ([label, path]) => {
      try {
        return { label, path, html: await fetchPage(path) };
      } catch (err) {
        console.error("site snapshot:", err.message);
        return { label, path, html: null };
      }
    })
  );

  const parts = pages.map(({ label, path, html }) =>
    `=== ${label} (${SITE_URL}${path}) ===\n` +
    (html ? pageText(html) : "(This page couldn't be loaded just now.)")
  );

  // Header and footer are identical on every page, so they appear once.
  const home = pages[0].html;
  if (home) {
    const header = (home.match(/<header\b[^>]*class="[^"]*site-header[\s\S]*?<\/header>/i) || [""])[0];
    const footer = (home.match(/<footer\b[\s\S]*?<\/footer>/i) || [""])[0];
    parts.push(
      "=== Menu and footer (the same on every page) ===\n" +
        pageText(`<body>${header}${footer}</body>`, { keepChrome: true })
    );
  }

  const text = parts.join("\n\n");
  // Only cache a complete snapshot, so a one-off failed fetch retries next turn.
  if (pages.every((p) => p.html)) cached = { at: Date.now(), text };
  return text;
}

module.exports = { siteSnapshot, pageText };
