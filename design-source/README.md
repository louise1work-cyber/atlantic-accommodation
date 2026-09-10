# Design source files

Working files that **produce** things the site ships — kept in the repo so the originals aren't
only in someone's Downloads folder, but **excluded from the deploy** by `.vercelignore`, so they
are never served to visitors and never count toward the bundle. Nothing here is referenced by
any page; deleting the folder would not change the live site.

## `favicon/`

The sunrise-over-water mark used for the browser tab icon.

| File | What it is |
|---|---|
| `favicon-master.png` | 600×600 flat artwork — the file `favicon.ico` was generated from |
| `favicon-master.psd` | layered Photoshop original, for editing the mark |
| `favicon-as-supplied.jpeg` | how it first arrived (a phone screenshot, with app UI around the edges) — kept only for provenance, not for use |

Supplied by Louise on 2026-09-08. The screenshot carries an "AI modified" badge from the phone
gallery app, so the artwork appears to have been AI-generated or AI-edited at some point — noted
here in case it ever matters for licensing.

### Regenerating `favicon.ico`

The shipped icon lives at the **site root** (`/favicon.ico`), not in `assets/` — browsers request
that exact path regardless of what the HTML `<link>` says, and a 404 there is why the site showed
a generic icon before 2026-09-08. It packs 16/32/48/64px frames so the tab icon stays crisp at
any DPI.

```bash
magick design-source/favicon/favicon-master.png -resize 64x64 \
  \( -clone 0 -resize 48x48 \) \( -clone 0 -resize 32x32 \) \( -clone 0 -resize 16x16 \) \
  -delete 0 favicon.ico
```

The mark is fine line-art on white; below about 32px the rays start to fill in, which is expected
and still reads as a sunrise at tab size.
