# Atlantic Accommodation — Website

A fast, self-contained static website for **Atlantic Accommodation** — self-catering holiday
rentals in **Langebaan** and **Dolphin Beach** on South Africa's Cape West Coast.

Guests can **book directly with the owners** (enquiry form) or jump straight to the same
listing on **Airbnb** and **Booking.com**.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home — hero, featured properties, "3 ways to book", how-it-works, about |
| `properties.html` | All four properties with booking channels |
| `properties/crew-house.html` | Atlantic Crew House (Langebaan, sleeps 15) |
| `properties/beach-cottage.html` | Atlantic Beach Cottage (Langebaan) |
| `properties/apartment.html` | Atlantic Apartment (Langebaan) |
| `properties/seaview-dolphin-beach.html` | Atlantic Seaview (Dolphin Beach, Cape Town) |
| `contact.html` | Contact details + direct-booking enquiry form |
| `assets/css/style.css` | All styling (coastal theme) |
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

**Confirmed** (from atlanticyachting.co.za):
- Contact: **+27 71 325 2574**, **info@atlanticyachting.co.za**, Club Mykonos, Agora Square, Langebaan, 7357
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

**Placeholders to replace before going live** (marked with `*` or "coming soon" on the site):
1. **Maps** — still "Map Coming Soon" placeholders on the four property pages and contact page.
2. **Bed / bath / guest counts** for Beach Cottage, Apartment and Seaview (currently estimated — marked `*`).
3. **Booking.com links** — buttons exist but point to `#`. Add the real URLs once the
   listings are created (search for `channel-btn--booking` and `chip--booking`).
4. **Maps** — "Map coming soon" placeholders; embed Google Maps if wanted.
5. **Social links** — Facebook/Instagram in the footer point to `#`.
6. **Enquiry form** — currently shows a success message only (no email is sent).
   Wire it to a form service (Formspree, Web3Forms) or a small backend. See the
   `data-enquiry` handler in `assets/js/main.js`.
7. Consider a dedicated email like `info@atlanticaccommodation.co.za` if you want the
   rentals brand separate from Atlantic Yachting.

## Brand

Design direction: **quiet classic hospitality** — muted, understated, no gradients or
soft/rounded cards. Restraint is the point; the photography should do the talking.

- Fonts: **EB Garamond** (headings) + **Inter** (body/labels), loaded from Google Fonts.
  Labels and buttons are uppercase with wide letter-spacing.
- Colours: warm ink `#2e2b26`, stone `#f7f5f1`, panel `#efebe4`, deep forest-charcoal
  `#343830`, and a single clay accent `#9a6a4a` used sparingly.
- Shapes: near-square corners (2px), hairline borders, **no drop shadows and no hover lift**.

All of the above are CSS variables at the top of `assets/css/style.css` — change the palette
there and it flows through every page.
