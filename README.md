# Atlantic Accommodation — Website

A fast, self-contained static website for **Atlantic Accommodation** — self-catering holiday
rentals in **Langebaan** and **Dolphin Beach** on South Africa's Cape West Coast.

Guests can **book directly with the owners** (enquiry form) or jump straight to the same
listing on **Airbnb**.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home — hero, featured properties, "2 ways to book", how-it-works, about |
| `properties.html` | All four properties with booking channels |
| `properties/crew-house.html` | Atlantic Crew House (Langebaan, sleeps 15) |
| `properties/beach-cottage.html` | Atlantic Beach Cottage (Langebaan) |
| `properties/apartment.html` | Atlantic Apartment (Langebaan) |
| `properties/seaview-dolphin-beach.html` | Atlantic Seaview (Dolphin Beach, Cape Town) |
| `contact.html` | Contact details + direct-booking enquiry form |
| `assets/css/style.css` | All styling (quiet classic hospitality theme) |
| `assets/js/main.js` | Mobile menu, scroll reveal, form handling |
| `api/enquiry.js` | Enquiry form handler — email via Resend, logs to Supabase |
| `api/ical/[property].js` | Per-property `.ics` calendar feed for Airbnb/Booking.com sync |
| `api/pay/[recordId].js` | Generates a PayFast payment link for one confirmed booking |
| `api/rates.js` | Optional "from R X" pricing feed, read from a Supabase `rates` table |
| `api/pay/webhook.js` | PayFast ITN handler — verifies and records a completed payment |
| `payment-success.html` / `payment-cancelled.html` | Where PayFast returns the guest to |
| `lib/supabase.js` | Shared Supabase REST client (guest database, bookings, rates) |
| `lib/ical.js` | iCalendar (.ics) file builder |
| `lib/payfast.js` | PayFast signing, verification and payment-field builder |

## Run it locally

It's plain HTML — just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 4173
# then visit http://127.0.0.1:4173
```

## Deploy

Any static host works (Vercel, Netlify, Cloudflare Pages, or normal web hosting).
For **Vercel**: `npm i -g vercel` then run `vercel` in this folder — no build step needed.

## What's placeholder vs. confirmed

**Confirmed:**
- Phone **+27 71 325 2574** and the address **Club Mykonos, Agora Square, Langebaan, 7357**
  (both from atlanticyachting.co.za — same owners)
- Email **info@atlanticaccommodation.co.za** — the rentals-branded address, set 2026-07-15,
  replacing the original `info@atlanticyachting.co.za`
- Airbnb links are live:
  - Beach Cottage → https://www.airbnb.co.uk/rooms/16727412
  - Apartment → https://abnb.me/M9eAErSYOzb
  - Seaview Dolphin Beach → https://www.airbnb.co.uk/rooms/1084129001354486118
- Crew House specs: 4 bed / 3 bath / sleeps 15, braai, fireplace, near Club Mykonos

**Photography** — real photos are in `assets/img/`, sourced from the accommodation page on
atlanticyachting.co.za (same owners) and re-encoded from PNG to JPEG (8.2 MB → 2.3 MB).
Originals are only ~800–1024px wide, so they're a little soft on high-DPI screens; replace with
higher-resolution originals when available.

| File | Shows |
|---|---|
| `crew-house.jpg` | Crew House — covered patio / pergola |
| `crew-house-kitchen.jpg` | Crew House — open-plan kitchen & dining |
| `crew-house-lounge.jpg` | Crew House — TV lounge |
| `crew-house-bedroom.jpg` | Crew House — twin bedroom (**not currently used**) |
| `beach-cottage.jpg` | Beach Cottage — patio at dusk (also the homepage hero) |
| `apartment.jpg` | Apartment — open-plan living |
| `dolphin-beach.jpg` | Seaview — living area |
| `langebaan-lagoon.jpg` | Lagoon panorama (About section) |

Only the Crew House has enough photos for a gallery. The other three have one photo each, so their
detail pages show a single full-width image — deliberately, since one real photo beside grey
placeholders reads as broken. Add more photos and they can use the `pd-hero` gallery like
`crew-house.html` does.

**Still outstanding:**
1. **Maps** — "Map Coming Soon" placeholders on the four property pages and the contact page;
   embed Google Maps if wanted.
2. **Bed / bath / guest counts** for Beach Cottage, Apartment and Seaview are estimates, marked
   with `*` on the site. Confirm against the Airbnb listings.
3. **Social links** — Facebook/Instagram in the footer point to `#`.
4. **Enquiry form — needs `RESEND_API_KEY` set in Vercel.** Everything else is built.
5. **Guest database & calendar sync — Supabase project is built, just needs
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` set in Vercel.** See "Guest database & calendar
   sync" below. Enquiries still email fine without it; only the guest-database logging and the
   `.ics` feeds are skipped (feeds return 503) until it's set up.
6. **Payment — needs a PayFast account + `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` /
   `PAYFAST_PASSPHRASE` set in Vercel.** See "Taking payment (PayFast)" below. Defaults to
   PayFast's sandbox until `PAYFAST_MODE=live` is set deliberately — test a real sandbox
   transaction first.

## The enquiry form

`contact.html` posts JSON to **`/api/enquiry`** (`api/enquiry.js`), a Vercel Function that
sends two emails through [Resend](https://resend.com)'s REST API:

1. **the enquiry to the owners** at `ENQUIRY_TO`, with `reply-to` set to the guest — so hitting
   reply in your mail client answers them directly
2. **an instant branded confirmation to the guest**

It calls Resend over `fetch`, so there are **no npm dependencies and no build step** — the site
stays a plain static deploy.

### Activating it

1. Create an account at https://resend.com.
2. **Verify the domain** `atlanticaccommodation.co.za` (Resend → Domains → Add). Resend gives
   you DKIM/SPF records to add in xneelo's konsoleH. These are **TXT records only — they do not
   touch the MX record**, so email keeps working. Until the domain is verified Resend will only
   send from `onboarding@resend.dev`, which looks unprofessional to guests.
3. Create an API key (Resend → API Keys).
4. Add it to Vercel — do this yourself so the key never lands in the repo or a transcript:
   ```bash
   vercel env add RESEND_API_KEY production
   ```
   Then redeploy (`vercel deploy --prod`) or push any commit.
5. Once the domain is verified, also set `ENQUIRY_FROM`:
   ```bash
   vercel env add ENQUIRY_FROM production
   # value: Atlantic Accommodation <info@atlanticaccommodation.co.za>
   ```

| Env var | Required | Default |
|---|---|---|
| `RESEND_API_KEY` | **yes** | — |
| `ENQUIRY_TO` | no | `info@atlanticaccommodation.co.za` |
| `ENQUIRY_FROM` | no | `Atlantic Accommodation <onboarding@resend.dev>` |

### Why it's built this way

An earlier version always showed "thank you" and silently discarded the enquiry — that loses
real bookings. Now **success only shows when Resend confirms the send**. Any failure re-enables
the button and shows the email address and phone number so the guest still gets through.
Guest input is HTML-escaped before going into the email, fields are length-capped. If the guest
auto-reply fails, the request still succeeds — the enquiry itself already landed.

## Guest database & calendar sync

Three things share one Supabase project:

1. **Every enquiry builds a client profile** — not just a log line. Guests are deduplicated by
   email into a `clients` table, and every contact they've ever made is kept as its own timestamped
   row in `enquiries`, linked to that client. The point is future communication that isn't cold:
   Louise can see, for one guest, every property they've asked about, when they last got in touch,
   and any notes she's added — not just their most recent message.
2. **Confirmed direct bookings generate a live `.ics` calendar feed** per property, which Airbnb
   and Booking.com can import to block those dates automatically — see "Three-way calendar sync"
   below.
3. **Optional "from R X" pricing** — see below.

All three are **best-effort and optional**: the site works fully without Supabase configured
(enquiries still email through Resend; the calendar feed just returns 503 until it's set up).

### Why Supabase, not Airtable

This started on Airtable (simple, no-code, good enough for a flat guest list) and moved to
**Supabase** — a real hosted Postgres database — specifically to support a proper CRM shape:
one persistent record per guest with their full contact history against it, rather than one flat
row per enquiry with no memory of earlier contact from the same person. Airtable *can* do this
with linked records, but Supabase makes the "one client, many enquiries, full timestamped
history" relationship a first-class part of the schema instead of something bolted on. It's still
completely free at this scale, and **Supabase Studio** (the web dashboard) gives Louise the same
kind of no-code table view Airtable did — browse, filter, edit a cell, add a note — without ever
touching code.

The repo is **public**, so this data can never live in a file in it — Row Level Security is
enabled on every table with no anon/public policies, so the *only* key that can read or write
this data is the `service_role` secret key, which lives solely in Vercel's environment variables.

### The schema

Project: **`atlantic-accommodation`** (ref `wxurpvcmtfacgxzqnqnq`, region `eu-west-1`), built
2026-07-24. Three tables in the `public` schema:

**`clients`** — one row per guest, deduplicated by email:

   | Column | Type | Notes |
   |---|---|---|
   | `id` | uuid, primary key | |
   | `first_name` / `surname` | text | |
   | `email` | text, unique | how guests are deduplicated across visits |
   | `phone` | text | |
   | `marketing_consent` | boolean | only ever moves **false → true**, never silently reverted — see POPIA below |
   | `consent_recorded_at` | timestamptz | when consent was given |
   | `notes` | text | **freeform — Louise's own space** in Supabase Studio for anything worth remembering: an occasion, a preference, "always books Crew House", a quirk from a phone call. This is the main lever for making future contact feel personal rather than templated |
   | `first_contacted_at` | timestamptz | set once, on creation |
   | `last_contacted_at` | timestamptz | bumped automatically by a database trigger every time a new enquiry comes in |
   | `created_at` / `updated_at` | timestamptz | |

**`enquiries`** — one row per contact, the timestamped history behind each client:

   | Column | Type | Notes |
   |---|---|---|
   | `id` | uuid, primary key | this is the ID used in PayFast payment links |
   | `client_id` | uuid, references `clients` | |
   | `property` / `check_in` / `check_out` / `guests` / `message` | | what they asked about |
   | `source` | text | e.g. `Website enquiry` |
   | `confirmed_booking` | boolean | ticking this is what drives the `.ics` feed |
   | `amount_due` | numeric | set once a price is agreed, see "Taking payment" |
   | `payment_status` | text | `Not Requested` / `Requested` / `Paid` |
   | `pf_payment_id` | text | PayFast fills this in automatically once paid |
   | `created_at` | timestamptz | **the exact timestamp of this contact** — set automatically, this is the full history a client's profile is built from |

**`rates`** — optional per-property pricing, see below.

Nothing else to build here — the project, tables, triggers and security are already live. The
only remaining step is yours (a service-role key is a credential — not something generated on
your behalf):

1. In the [Supabase dashboard](https://supabase.com/dashboard/project/wxurpvcmtfacgxzqnqnq) →
   **Project Settings → API**, copy the **`service_role`** secret key (not the `anon`/publishable
   one — that one can't write past Row Level Security).
2. Set these in Vercel yourself, so nothing lands in the repo or a chat transcript:
   ```bash
   vercel env add SUPABASE_URL production
   # value: https://wxurpvcmtfacgxzqnqnq.supabase.co

   vercel env add SUPABASE_SERVICE_ROLE_KEY production
   # paste the service_role secret key you just copied
   ```
3. Push or redeploy. From then on every enquiry creates or updates a client and logs a new
   timestamped enquiry row.

### Showing a "from R X" price (optional, off by default)

Every property page currently shows **"Enquire — for rates & availability"** instead of a
number, because rates change too often to hardcode into the page. If that ever changes, there's
already a wired-up path to show a real price **without touching any HTML** — you'd only ever
edit a number in Supabase Studio.

The `rates` table already exists with these columns: `property` (text, must exactly match one of
the 4 property names used in `enquiries`, e.g. `Atlantic Crew House`), `from_price` (numeric),
`per` (`night` or `week`). It has no rows yet, so every property still shows "Enquire". To switch
one on:

1. In Supabase Studio's table editor, add a row for that property with its `from_price` and `per`.
2. That's it — no redeploy needed. Each property page reads `/api/rates` (cached 15 minutes) and
   swaps in "From R{amount} — per night/week" automatically once the row exists. Leave a property
   with no row (or no price) and its page just keeps showing "Enquire".

This is entirely optional and fails silently: if Supabase isn't configured, the `rates` table is
empty, or a property has no row, the page is unaffected — it just shows "Enquire" as it does today.

### Confirming a booking (this drives the calendar feed)

There's no booking-confirmation UI built into the site on purpose — Supabase Studio's table
editor already is one. Once you've confirmed a direct booking by phone or email:

1. Find that guest's enquiry row in the `enquiries` table (or their client record in `clients` if
   you want to see their full history first).
2. Fill in / correct **`check_in`** and **`check_out`** if they changed.
3. Tick **`confirmed_booking`**.

That's it — the calendar feed for that property picks it up automatically (cached up to 15
minutes; see below).

## Taking payment (PayFast)

Lets a guest pay for a confirmed booking by card or EFT, without you ever handling card details —
the guest pays on PayFast's own hosted page, not on this site.

**What this is not (yet):** a live "pick dates, see a price, pay instantly" checkout — the site
has no rates table, so there's no automatic price to charge. This is a *payment request* flow:
you confirm a booking and a price the normal way (phone/email), then send the guest a link that
charges exactly that amount.

### Setting it up

1. Create a free PayFast account at https://payfast.io (no monthly fee — you only pay a
   per-transaction fee, roughly 3.5% + R2 for cards or ~2% for Instant EFT, at time of writing).
   **Create a Sandbox account first** (PayFast's own recommendation) and test a real payment
   there before ever switching this to live — see step 4.
2. In your PayFast dashboard, find your **Merchant ID** and **Merchant Key** (Settings), and set
   a **Passphrase** (also in Settings — this is a secret salt used to sign every transaction;
   make one up, don't leave it blank).
3. Set these in Vercel yourself:
   ```bash
   vercel env add PAYFAST_MERCHANT_ID production
   vercel env add PAYFAST_MERCHANT_KEY production
   vercel env add PAYFAST_PASSPHRASE production
   ```
4. Leave `PAYFAST_MODE` unset (or set to `sandbox`) and test a full payment using PayFast's
   sandbox test card/EFT details first. **Only once that's worked**, set it to go live:
   ```bash
   vercel env add PAYFAST_MODE production
   # value: live
   ```

### Using it

1. Confirm the booking in Supabase as above.
2. Fill in **`amount_due`** on that enquiry row with the agreed price (in rand).
3. Send the guest this link (swap in that row's `id` — visible in Supabase Studio's table editor,
   or by clicking into the row):
   ```
   https://www.atlanticaccommodation.co.za/api/pay/00000000-0000-0000-0000-000000000000
   ```
4. The guest is redirected into PayFast's checkout. Once they pay, **`payment_status` updates to
   `Paid` in Supabase automatically** — PayFast confirms this to the site directly (the ITN
   webhook, `api/pay/webhook.js`), it isn't based on the guest simply reaching the "thank you"
   page, which anyone could navigate to without paying.

### Why this is safe to trust

A webhook that says "payment successful" is only as trustworthy as the checks behind it — anyone
could POST a fake "COMPLETE" to a guessable URL otherwise. `api/pay/webhook.js` runs all four
checks PayFast's own integration docs specify, and a booking is only marked Paid if **every one**
passes:
1. the payload's signature is valid (proves it wasn't altered in transit)
2. the request actually originates from a PayFast server (checked against PayFast's own domains,
   not a spoofable header)
3. the amount paid matches what was actually requested
4. PayFast's own server confirms the transaction when asked directly, server-to-server

All four were tested independently — each one failing on its own (bad signature, wrong source,
wrong amount, PayFast declining to confirm) correctly blocks the booking from being marked Paid,
not just the case where everything happens to go wrong at once.

### Three-way calendar sync (Airbnb ↔ Booking.com ↔ direct)

Each property has a feed at:

```
https://www.atlanticaccommodation.co.za/api/ical/crew-house.ics
https://www.atlanticaccommodation.co.za/api/ical/beach-cottage.ics
https://www.atlanticaccommodation.co.za/api/ical/apartment.ics
https://www.atlanticaccommodation.co.za/api/ical/seaview-dolphin-beach.ics
```

It lists every row in Supabase for that property where **`confirmed_booking`** is true, as
blocked all-day date ranges — nothing else. No guest name, email, or phone is ever included in
this feed (it's handed to two external platforms, so it carries the same amount of information
their own export feeds do: dates only).

To wire up full 3-way sync, for **each** property:

1. **Airbnb** → that listing → Calendar → Availability settings → Sync calendars → paste this
   site's `.ics` URL under "Import calendar", and also import **Booking.com's** export URL there.
2. **Booking.com** → Extranet → Calendar → Sync calendars → import **Airbnb's** export URL and
   this site's `.ics` URL.
3. Nothing to configure on the "direct" side beyond ticking **`confirmed_booking`** in Supabase —
   this site's feed only ever needs to be read by the other two, never the reverse.

**Honest limitation, not something this fixes:** both platforms poll imported calendars on their
own schedule, not instantly — Airbnb roughly every 1–2 hours, Booking.com up to 24. There's a
real (if small, for enquiry-based rather than instant-book properties) window where a booking on
one platform hasn't blocked the others yet. Upgrading that requires a paid channel manager with
direct API access (Lodgify, Uplisting) — worth revisiting only if that lag ever actually causes
a clash.

### POPIA (consent)

The marketing-consent checkbox on the enquiry form is **unticked by default** and entirely
optional — leaving it unticked doesn't block the enquiry. Every enquiry is still logged to
Supabase regardless (that's the same operational record-keeping as sending the email — fulfilling
the guest's own request), but **only clients with `marketing_consent` = true should ever be used
to send marketing**. The consent timestamp is recorded alongside it on the client record, and —
because consent lives on the client, not the individual enquiry — it only ever moves from false to
true; a later enquiry from the same person with the box left unticked can't silently erase consent
they already gave. No unsubscribe flow exists yet because no marketing is being sent yet — build
one before the first campaign, not before.

## Anti-spam

Three layers on `/api/enquiry`, so you don't get spam mail:

1. **Honeypot** — a hidden `botcheck` field. Bots fill it, humans can't see it. Always on.
2. **Timing trap** — submissions faster than 2.5s (measured client-side, so it's immune to
   clock skew) are dropped as bots. Always on.
3. **Cloudflare Turnstile** — a free, near-invisible bot check, verified server-side. **Off until
   you configure it**, so the form works before setup; switches on automatically once the keys
   are in.

### Activating Turnstile (optional but recommended — you're already on Cloudflare)

1. Cloudflare dashboard → **Turnstile** → add a widget for `atlanticaccommodation.co.za`.
   You get a **site key** (public) and a **secret key**.
2. In `contact.html`, replace `REPLACE_WITH_TURNSTILE_SITE_KEY` (on the `<form>`) with the site key.
3. Add the secret to Vercel (do it yourself so it stays out of the repo):
   ```bash
   vercel env add TURNSTILE_SECRET_KEY production
   ```
4. Push / redeploy.

The site key is **public** by design (it ships in the page); only the secret must stay private.
Bots that never load the page — the most common source of form spam — are already blocked by the
honeypot and timing trap without Turnstile.

## Security headers

`vercel.json` sets site-wide headers on every response: a **Content-Security-Policy** that only
allows the resources this site actually uses (self, Google Fonts, Cloudflare Turnstile), plus
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (+ CSP `frame-ancestors 'none'`) to
prevent clickjacking, `Referrer-Policy`, `Strict-Transport-Security`, and a restrictive
`Permissions-Policy`. If you add a new external resource (an embedded map, an analytics script),
update the CSP or the browser will block it.

## Brand

Design direction: **coastal estate** — sage, blush and deep forest green on white, airy and
elegant. Adapted from [westrocklangebaan.co.za](https://westrocklangebaan.co.za) at the owner's
request. (West Rock is a Langebaan *property development* selling homes — not a holiday-rental
competitor.) The underlying restraint from the previous direction is kept: hairline borders,
no gradients, no drop shadows, no hover lift; the photography does the talking.

### Palette

| Token | Hex | Use |
|---|---|---|
| `--deep` | `#154734` | deep forest — dark sections, primary buttons |
| `--sage` | `#83a198` | signature sage — **decorative only** (borders); 2.8:1, too light for text |
| `--sage-deep` | `#55736a` | text-safe sage — labels, accents (5.2:1) |
| `--blush` | `#d5afa2` | signature blush — CTA fills |
| `--ink` | `#16302a` | headings (14.1:1) |
| `--ink-soft` | `#3f524b` | body copy (8.3:1) |
| `--muted` | `#627972` | secondary text (4.7:1) |
| `--bg` / `--panel` | `#ffffff` / `#f6f9f7` | page / subtle panel |

Sage and blush come straight from West Rock. **Where we deliberately differ:** they set text in
sage on white (~2.8:1) and white on blush (~2:1), both of which fail WCAG AA. We use the same
colours but pair them for contrast — blush buttons carry deep-green text at 5.29:1. Every text
colour here passes AA.

### Type

- **Montserrat** (body, labels, buttons) — matches West Rock exactly; uppercase with wide tracking.
- **Cormorant Garamond** (display) — free stand-in for West Rock's `the-seasons`, which is a
  licensed Adobe Typekit font we can't use. Cormorant has a true italic, which the hero headline
  needs, but a small x-height and light 400 — hence headings are sized up and set at 500.

### Shapes

Full pills on buttons (`--radius-pill`), 4px on cards — both taken from West Rock.

All of this lives in CSS variables at the top of `assets/css/style.css` — change them there and
it flows through every page.

### Logo

The header and footer use the business's real logo — the "Atlantic / ACCOMMODATION" wordmark
pulled from their Facebook page (facebook.com/profile.php?id=100054578195109), not a placeholder.
The original is dark navy on white; it's been recoloured and exported as two transparent PNGs so
it drops onto both a light and a dark background cleanly:

| File | Colour | Used in |
|---|---|---|
| `assets/img/logo-deep.png` | `--deep` (site green) | header, light background |
| `assets/img/logo-white.png` | white | footer, dark background |

Both are the same crop at 651×229px (native resolution from the source image — Facebook doesn't
serve profile pictures larger than roughly that). Displayed at 44px tall in the header and 54px
in the footer via `.brand__logo` in `style.css`; `width: auto` keeps the aspect ratio intact at
any size, so don't set a fixed width on it.

The favicon is intentionally a separate, simpler mark (a small wave icon) — the wordmark is too
wide to read at 16–32px, so it isn't used there.
