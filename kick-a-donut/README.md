# Kick a Donut — marketing site

Static site for **kickadonut.ainovations.net**. Plain HTML/CSS, no build step.

## Pages
| File | URL | Purpose |
|------|-----|---------|
| `index.html` | `/` | Home — hero, loop, worlds, pets, story hook, play CTA |
| `guide.html` | `/guide` | How to play — worlds, pets, trails, rebirth |
| `story.html` | `/story` | The family story + call to help hit 500 players |

Clean URLs (`/guide`, `/story`) are handled by `_redirects`.

## SEO wiring (already done)
- Unique `<title>` + meta description per page
- Canonical tags, Open Graph + Twitter cards (link previews)
- JSON-LD: `VideoGame` (home), `HowTo` (guide)
- `sitemap.xml` + `robots.txt`

## Assets
`assets/icon-512.png` — real game icon, pulled from Roblox. Used as favicon, hero art, and OG image.

**Optional upgrades (drop files into `assets/`):**
- `og-hero.png` (1200×630) — a wider social card. If added, update the `og:image` / `twitter:image` URLs in each page's `<head>` to `/assets/og-hero.png`. The four 1920×1080 banners (KICK A DONUT / TRAIN·KICK·GET PAID / 5 CRAZY WORLDS / HATCH EPIC PETS) are perfect source material — export one at 1200×630.
- The banners can also be embedded on the Home page as a screenshot strip if desired.

## Deploy (Netlify)
This folder is a **separate Netlify site** from the main ainovations.net site.

1. Netlify → **Add new site** → connect this repo.
2. **Base directory:** `kick-a-donut`
3. **Publish directory:** `kick-a-donut`
4. Build command: *(leave blank — static)*
5. Deploy, then **Domain settings** → add custom domain `kickadonut.ainovations.net`.
6. In your DNS, add a **CNAME** `kickadonut` → the Netlify site (e.g. `your-site.netlify.app`). HTTPS provisions automatically.
