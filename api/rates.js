/**
 * Optional "from R X" pricing feed, read by assets/js/main.js on each property page.
 *
 * Best-effort and fail-soft by design: property pages default to "Enquire — for
 * rates & availability" and only switch to a shown price once a row exists for
 * that property in the rates table. Supabase being unconfigured, the table
 * being empty, or any read error all produce the same result — an empty
 * object — so a page never shows an error, just the existing Enquire fallback.
 */

const { configured, listRates } = require("../lib/supabase");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");

  if (!configured()) {
    res.status(200).json({});
    return;
  }

  try {
    const records = await listRates();
    const rates = {};
    for (const record of records) {
      const property = record.property;
      const fromPrice = Number(record.from_price);
      if (!property || !(fromPrice > 0)) continue;
      const per = record.per === "week" ? "week" : "night";
      rates[property] = { fromPrice, per };
    }
    res.status(200).json(rates);
  } catch (err) {
    console.error("Rates read failed (falling back to Enquire):", err.message);
    res.status(200).json({});
  }
};
