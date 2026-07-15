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
Guest input is HTML-escaped before going into the email, fields are length-capped, and a hidden
`botcheck` honeypot catches spam. If the guest auto-reply fails, the request still succeeds —
the enquiry itself already landed, and that's what matters.

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
