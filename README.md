# Forever Forge

A crafting companion for **World of Warcraft: Forever**, served at [wow-forever-forge.com](https://wow-forever-forge.com): every recipe of every profession, with reagents, skill-up colors, tools, crafting stations, cooldowns, the recipe items that teach them, and what changed since Classic Era.

All game data is read from the public game client (via [wago.tools](https://wago.tools) DB2 exports) and compared with Classic Era. Until November 2026 the site was a talent and build site; those tools were retired (see git history).

## What's here

| Route | What it does |
| --- | --- |
| `/` | Search every recipe at once (by name, result or reagent), every profession, what the site does |
| `/professions` | All professions: crafting, gathering, secondary |
| `/professions/<name>` | One profession: every recipe as a card (skill-up colors, reagents, station, tools, recipe item), filters (category, new in Forever, changed from Classic, recipe item or not), and "your skill" that colors each recipe orange/yellow/green/grey like the profession window. The About tab has ranks, specializations, stations, tools, cooldowns and, for gathering professions, their materials |
| `/professions/<name>/<spell id>` | One recipe: reagents for any number of crafts, which reagents are crafted too and the raw materials underneath, skill-up colors, requirements, how to learn it, the made item's tooltip, and the Classic Era difference |
| `/moderate` | Approve or reject a player's source report (opened from the signed link in the email) |
| `/list` | Crafting list: recipes you plan to craft and how many, with a shopping list (as written, or broken down to raw materials) you can tick off, copy as text or share as a link |
| `/items`, `/items/<id>` | Item database: every item with its tooltip, Classic Era comparison, and the recipes that make it or use it |
| `/privacy`, `/imprint` | Legal pages |

Item tooltips appear on hover with a mouse and as a sheet on tap on phones (`src/itemtip.ts`). The crafting list and the skill you enter live in the browser's local storage; there are no accounts.

## Architecture

- **Frontend:** Vite + TypeScript, no framework (`src/`). Written for phones first; wider screens add to the layout with `min-width` queries.
- **Look:** a WoW Forever interface: Forever's night-blue sky behind game-style frames (dark panels with gold metal borders), headings in the game's gold, red buttons, edit boxes and tabs like the game's, and the profession page laid out like the in-game profession window (recipe list grouped by category, names in skill-up colors, a detail pane with reagent slots). All CSS (`src/style.css`), no Blizzard artwork; item quality and skill-up colors are the game's own. Inter, Marcellus (interface headings) and Cinzel (logo and big titles) are self-hosted.
- **Server:** Cloudflare Pages Functions. `functions/_middleware.ts` renders every page address through `server/pages.ts` (see *Search engines*); `functions/api/[[path]].ts` → `server/api.ts` takes bug reports into a **D1** database (`migrations/`).
- **Ads:** `src/ads.ts` reserves each slot's size up front. Without AdSense (`VITE_ADSENSE_*`, see `.env.example`), `VITE_AD_FALLBACK=house` shows the site's own promos.

## Develop

```bash
npm install
npm run data                  # fetch DB2 tables (cached in pipeline/.cache) and write public/data
npm run dev                   # Vite on :5173 + wrangler (bug-report API + local D1) on :8788
npm test                      # unit tests + API tests against an in-memory D1
```

`npm run data:refresh` re-discovers the newest game build. The pipeline needs only Python's standard library and takes seconds once the tables are cached.

## How the data works

`pipeline/build_data.py` downloads the DB2 tables of the newest Forever build and of Classic Era, then writes `public/data/`:

- **Professions** (`pipeline/extras.py`, `professions/<slug>.json`): every `SkillLineAbility` of a profession that makes an item or takes reagents is a recipe.
  - Reagents from `SpellReagents`, the made item and its count from the create-item spell effect.
  - Skill-up colors from `TrivialSkillLineRankLow` (yellow) and `…High` (grey); green starts halfway between, as the game computes it.
  - Category from `TradeSkillCategory`, tools from `SpellTotems`/`TotemCategory`, crafting station from `SpellCastingRequirements`/`SpellFocusObject`, cooldown from `SpellCooldowns`, skill points per craft from `NumSkillUps`.
  - Recipe items ("Plans: …", "Pattern: …") are items whose learn effect teaches the recipe. Their required skill is the only reliable "learned at" value: the client's `MinSkillLineRank` is 1 for nearly every recipe (Classic Era's too; trainers keep the real value server-side). Without a recipe item the site shows "?" rather than guess.
  - Ranks (Apprentice to Artisan) and specializations are the profession's abilities that aren't recipes, with their tooltips.
  - Gathering professions list the materials the game files class under them (herbs, metal & stone, leather, meat). Where they're gathered and at what skill isn't in the client.
  - Classic Era comparison: a recipe is new if Classic Era doesn't have it, and changed if its reagents or skill-up ranges differ.
- **Crafted reagents** (`makersOf` in `src/crafting.ts`): breaking a recipe down to raw materials follows the recipe that makes each reagent. A plain recipe wins over a cooldown (smelt rather than transmute). Whatever skinning, herbalism and fishing gather counts as raw (leather "upgrades" would otherwise turn into thousands of scraps), and so do two-way conversions like lesser and greater essences.
- **Item database** (`pipeline/itemdb.py`, `items/db/`): about 17,700 items.
  - `index.json`: compact search rows. `d/<id % 128>.json`: item details, sharded. `meta.json`: item class names.
  - Stats come from `ItemSparse` percentages times the `RandPropPoints` item-level budget (`ItemMath` in `pipeline/extras.py`); Classic Era stores final numbers. Forever's new stat types are named and valued only where the budget reproduces Classic's numbers exactly, otherwise "?".
  - Items are compared with Classic Era by ID, or by a unique name when Forever reissued an item. Wording alone never counts as a change.
  - Drop sources and vendors aren't in the client files, so they aren't listed.
- **Where recipes come from in Classic Era** (`pipeline/classic_sources.py`, `professions/sources-classic.json`): the client has no loot, vendor or trainer data (Blizzard keeps it server-side), so the recipe pages show Classic Era's from the open-source [CMaNGOS Classic database](https://github.com/cmangos/classic-db) (GPL v3; the dump is cached in `pipeline/.cache/cmangos/`), always labeled "Classic Era, community data; WoW Forever may differ":
  - Drops with chances, worked out by CMaNGOS's loot rules (ungrouped rows roll on their own, one item per group with explicit chances first and the rest shared, references rolled `maxcount` times). Loot shared by more than 12 creatures is summarized as a world drop.
  - Vendors (with limited supply and faction), quest rewards, chests and containers, and the skill and price trainers teach each recipe at.
  - Locations come from spawn positions and the Classic client's own maps: each zone map's rectangle (`UiMapAssignment`), and where rectangles overlap, the zone whose explored-area overlays (`WorldMapOverlay` hit rectangles) cover the spot. That also names the subzone ("Tarren Mill, Hillsbrad Foothills").
  - Its COPYRIGHT note asks that the Blizzard-derived content not be used commercially; with ads back on, reconsider this file.
- **Meta** (`meta.json`): the build, its phase (beta or live), and class names for item tooltips.

**Rule: never extrapolate game numbers.** What the client doesn't say shows as "?" or "not in the client data".

### Builds and launch

`discover_builds()` treats every `1.x` client with a minor version of 60 or more as Forever. If a Forever build exists under a live (non-test) wago.tools product, the phase is `live`; set the repository variable `FOREVER_PHASE=live` (or `beta`) to override. `.github/workflows/refresh-data.yml` rebuilds the data every 4 hours and commits it when anything changed; Cloudflare Pages redeploys on the push.

## Search engines

The app is a single-page app, so `functions/_middleware.ts` sends every page address through `server/pages.ts`:
- **Status codes:** 404 for unknown pages, professions, recipes and items; **410 Gone** for the retired tools (`/talents`, `/builds`, `/sets`, …). `www.` and the old `pages.dev` address redirect to the domain.
- **Head tags:** title, description, canonical link, social preview tags (one site-wide card, `public/og-default.png`) and JSON-LD breadcrumbs.
- **Pre-rendered content:** the home page, profession pages (every recipe with its reagents), recipe pages and item pages carry their main content as plain HTML until the app starts.
- **Sitemaps:** `sitemap.xml` indexes `sitemap-pages.xml` (professions and every recipe) and `sitemap-items.xml`, written at build time by a Vite plugin (`VITE_SITE_URL`).

## Bug reports

"Report a bug" (header on desktop, menu on phones, footer, and "Something look wrong?" under the data) opens a short form. It sends the message, the page address, browser, screen size and game build. Reports go to the `feedback` table, and by email when `RESEND_API_KEY`, `MAIL_FROM` and `FEEDBACK_EMAIL` are set on the Pages project. Spam is limited per IP and by a honeypot field; reports are deleted after 12 months at the latest.

## Player reports: where recipes drop in Forever

"Where did you find it?" on every recipe page lets players report a source (drop, vendor, quest, trainer, container, other) with the place, zone and a note. Reports are anonymous, rate-limited per IP and honeypotted, and stored in the `source_reports` table (`migrations/0006_source_reports.sql`). Each one is emailed to `FEEDBACK_EMAIL` with Approve and Reject links signed with `REPORT_SECRET` (HMAC); the link opens `/moderate`, which confirms with a POST so mail scanners following links can't decide anything. Approved reports show on the recipe page, identical ones merged with how many players reported them (`GET /api/sources/<profession>/<spell>`, cached 5 minutes). Reports nobody approves are deleted after 90 days.

Set the secret once: `openssl rand -hex 32 | npx wrangler pages secret put REPORT_SECRET --project-name forever-forge`.

## Logo and preview card

The medallion (a hammer over an anvil on a night-blue field in a gold rim) is original artwork defined once in `shared/logo.ts`. `node scripts/write-logo.ts` copies it into the header and `public/favicon.svg` and renders the home-screen icon. The preview card is `defaultCardSvg()` in `server/og.ts`, rendered with `node --import ./scripts/ts-resolve.mjs scripts/write-og-default.ts`.

## 3D set models (offline experiment)

`scripts/model3d/build_set_model.py <set id> [race] [gender]` builds a static glTF model of a character wearing an item set from the client files (needs numpy). The models are Blizzard assets, so `public/models/` isn't committed, and the site doesn't show them (the viewer was removed in November 2026).

## Deploy (Cloudflare Pages + D1)

The site runs on the Workers Free plan: `public/_routes.json` sends static files (scripts, data, fonts, images, sitemaps) straight to the CDN, so only page loads and bug reports count against the daily Function requests.

1. `npx wrangler d1 create forever-forge`, then put the printed `database_id` in `wrangler.toml`.
2. `npm run db:migrate` to create the tables in the remote database.
3. Create the Pages project by connecting the Git repo (build command `npm run build`, output `dist`) and bind the D1 database as `DB`. Every push to `main` deploys.
4. Add `wow-forever-forge.com` as a custom domain.

`npm run build` prints a short checklist (operator details in `src/views/legal.ts`, the D1 id, ads). With AdSense, also enable its certified consent message for EU visitors.

## Ideas for later

- A "sold by a vendor" / "drops" filter on profession pages, from the Classic and player-reported sources.
- A skill-up path: the cheapest recipes to go from one skill to another, from the colors and reagent counts.
