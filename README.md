# Forever Forge

Theorycrafting and build tools for **World of Warcraft: Forever**, served at [wow-forever-forge.com](https://wow-forever-forge.com).

All game data is read from the public beta client (via [wago.tools](https://wago.tools) DB2 exports). Each talent is diffed against Classic Era and against every earlier beta build.

## What's here

| Route | What it does |
| --- | --- |
| `/talents/<class>/<code>` | Talent calculator with the changes lens, a leveling-order timeline, and share links that flag talents changed since the link was made |
| `/changes` | Talent changelog between consecutive beta builds |
| `/changes/classic/<class>` | Word-level diff of every talent vs Classic Era |
| `/races` | Race × class matrix, with new combinations highlighted |
| `/builds`, `/builds/<id>` | Community builds: browse, search, sort by rating, and rate (1–5 stars) |
| `/login`, `/signup`, `/account` | Accounts: save, edit and delete builds; change password; delete account |
| `/verify-email`, `/forgot-password`, `/reset-password` | Email confirmation and password reset (one-time emailed links) |
| `/admin` | Moderation queue for reported builds (admins only) |
| `/compare/<class>/<a>/<b>` | Two builds overlaid, with every differing talent and its tooltip at each rank |
| `/leveling/<class>/<code>` | Level 1–60 plan: talent points, trainer abilities, dungeons opening up |
| `/legacy/<code>` | Legacy (account-wide) point planner and every way to earn points |
| `/gear/<class>?i=…` | Gear sandbox: real beta items, stat totals and an editable formula sheet |
| `/professions/<name>` | Recipe browser with reagents, difficulty and "new in Forever" markers |
| `/flights/<continent>` | Flight map and route planner: every learnable flight point and route with prices, new ones (and new zones) marked |

The calculator also has a **popularity lens**: each talent is shaded by how many public builds take it, optionally at the level you scrub to. Users can **watch** a class or a saved build to get emailed when a new beta build changes its talents. Share links and build pages have generated **social preview images** (`/og/…`), so they unfurl nicely in Discord and elsewhere.
| `/privacy`, `/imprint` | Legal pages (fill in `SITE_OPERATOR` in `src/views/legal.ts` first) |

## Architecture

- **Frontend:** Vite + TypeScript, no framework (`src/`). Inter is self-hosted, so no request goes to Google Fonts. The color scheme is sampled from Blizzard's [WoW: Forever page](https://worldofwarcraft.blizzard.com/de-de/forever): its hero painting, section gradients, buttons and text. The colors are defined and annotated at the top of `src/style.css`. Backgrounds are plain CSS gradients in those colors; no artwork, and no Blizzard artwork or logos. Headings use Marcellus, served from the site itself. Class and item-quality colors are the game's own.
- **API:** Cloudflare Pages Functions (`functions/api/[[path]].ts` → `server/api.ts`) with a **D1** (SQLite) database. The schema lives in `migrations/`.
- **Auth:** PBKDF2-SHA256 password hashes and random session tokens in an `HttpOnly; SameSite=Lax; Secure` cookie. Only the token's SHA-256 is stored. State-changing requests must come from the site's own origin, and login/signup are rate-limited per IP.
- **Email:** `server/mail.ts` sends through [Resend](https://resend.com) when `RESEND_API_KEY` is set. In `npm run dev`, mail goes to a local outbox instead (`GET /api/dev/outbox`, enabled by the `DEV_MAIL_OUTBOX` binding). Confirming your email is required to publish or rate builds; private builds work without it. Password resets sign you out on other devices.
- **Moderation:** signed-in, confirmed users can report a public build once. After 3 open reports the build is hidden until an admin dismisses the reports, hides it, or deletes it. To make someone an admin, run `npm run make-admin -- <username>` (add `--remote` for production).
- **Shared validation:** `shared/validate.ts` is used by both the forms and the API.
- **Ads:** `src/ads.ts` reserves each slot's size up front, so the layout doesn't shift when ads load. Placements:
  - **Sidebar:** a sticky 300×600 ad (`withRail`) beside the talent calculator, item search, changes pages and leveling planner, from 1280px wide. The builds list and professions pages already have sidebars, which use it too.
  - **In-list:** a banner every 40 rows in item and recipe lists (`withListAds`), every 8 changes in the beta changelog, and every 9 builds in the builds list. These only appear on the first render and on "Show more", never on keystroke re-renders, which AdSense would count as refreshing ads without user action.
  - **Banners:** one 728×90 (320×100 on phones) per page elsewhere, and on smaller screens where there's no room for the sidebar.
  - **Phones:** a sticky banner is best done with AdSense's own anchor ads (Auto ads → Anchor ads in the AdSense dashboard), which follow Google's policies.
  - **Configuration:** with the `VITE_ADSENSE_*` env vars set (see `.env.example`; `VITE_ADSENSE_SLOT_RAIL` is optional), the slots show AdSense ads. Without them, each slot shows a labeled "Ad space" placeholder at its real size. Set `VITE_AD_FALLBACK=house` to show the site's own promos instead.
  - **News:** the news page has no ad slots on purpose.

## Develop

```bash
npm install
npm run data                  # fetch DB2 tables (cached in pipeline/.cache) and write public/data
npm run dev                   # Vite on :5173 + wrangler (API + local D1) on :8788, migrations applied
node scripts/seed-local.mjs   # optional: confirmed demo users, builds and ratings in the local DB
npm run make-admin -- Demo    # optional: make the demo user a moderator (local DB)
npm test                      # unit tests + API tests against an in-memory D1
```

`npm run data:refresh` re-discovers the newest beta build. The pipeline needs only Python's standard library.

## How the data works

`pipeline/build_data.py` (plus `pipeline/extras.py`) downloads DB2 tables for each Forever build (`1.60.x`) and the latest Classic Era build, then:

1. **Reads talents from the trait system.** Forever's real talent trees are trait trees (`TraitTree`/`TraitNode`…). The old `Talent` table in the Forever client is stale. Node positions give tier and column, `TraitCond` gives the points required, `TraitEdge` gives prerequisites, and `TraitDefinitionEffectPoints` curves give the exact value for every rank.
2. **Renders tooltips**, resolving `$s1`, `$d`, `${expr}`, `$/10;s1`, `$?cond[][]` and so on with the per-rank values. The few values the client leaves blank show as `?`.
3. **Classifies each talent** vs Classic Era as `new`, `reworked`, `expanded` (Classic effect kept, something added), `tuned` (numbers only), `moved` or `unchanged`, matching by spell, then by name. Wording is ignored: a talent counts as changed only if its spell effects (effect type + aura + misc value) or the numbers in its tooltip differ, with durations normalized ("1 min" = "60 sec"). Talents that were checked by hand have an override with a short reason in `pipeline/classification-review.json`; each override stores the tooltip it was checked against, and the pipeline prints "Review needed" when a new beta build changes that text.
4. **Diffs consecutive beta builds** to produce `changelog.json`. That feeds the changelog page, the "changed since" warnings, and the change alerts.
5. **Extras:**
   - Trainer abilities by level come from `SkillLineAbility` and `SpellLevels`.
   - Dungeon minimum levels come from `LFGDungeons` and `ContentTuning`. Dungeons that aren't in the client yet use Blizzard's announced ranges from `pipeline/announced.json`, labeled as such.
   - The Legacy trees come from the 16-point trait currency.
   - Recipes come from `SkillLineAbility`, `SpellReagents` and create-item effects.
   - Flight points and routes come from `TaxiNodes`, `TaxiPath` and `TaxiPathNode`, projected onto the continent maps with `UiMapAssignment`. Only learnable points count (they have a `CharacterBitNumber`); transports, quest flights and retired `zzOLD` entries are skipped. Faction comes from the node flags, or from the flight master's mount where the flags don't say. The planner's distances are measured along `TaxiPathNode`.
   - The map behind it is built in `pipeline/mapshape.py` from the zone maps' explored-area overlays (`WorldMapOverlay`), projected onto the continent: they cover the land, so rasterizing, smoothing and tracing them gives a coastline and zone borders without any map artwork.
   - Item stats come from `ItemSparse` percentages times the `RandPropPoints` item-level budget. Armor comes from `ItemArmor*`, weapon DPS from `ItemDamage*`. Weapons with a special quality modifier show no damage rather than a guess.

## Item database

`/items` searches every item in the beta client, about 17,600 of them. Internal test and placeholder items are filtered out. Each item has a page at `/items/<id>` with:
- **Tooltip:** stats, armor, weapon damage, Use/Equip/Chance-on-hit effects, set bonuses, requirements, sell price and flavor text.
- **Classic Era comparison:** what changed against the same item in Classic Era.
- **Profession links:** the recipes that create it, and what it's a reagent for.

`pipeline/itemdb.py` builds `public/data/items/db/`:
- `index.json`: compact search rows, about 270 KB gzipped.
- `d/<id % 128>.json`: item details, sharded so an item page loads about 13 KB.
- `meta.json`: item class and subclass names.

`functions/items/[[path]].ts` gives item pages their own title and description for link previews.

How the numbers are read, and why they can be trusted:
- **Stats:**
  - Forever stores each stat as a share of an item-level budget (`StatPercentEditor` × `RandPropPoints`).
  - Classic Era stores the final numbers (`StatModifier_bonusAmount`, `Resistances`, `MinDamage`/`MaxDamage`). Both are handled by `ItemMath` in `pipeline/extras.py`.
- **New stat types:** Forever added stat types Classic doesn't have.
  - Named, with values: school spell damage, Fishing and All Resistances. Their meaning was inferred from the Classic version of the same items, and they're shown with values only because the budget formula reproduces Classic's numbers exactly.
  - Named, value shown as "?": attack power against Demons, Undead and Beasts. Their values don't reproduce Classic's (the formula gives exactly half), so a wrong number isn't shown.
  - Unidentified: the rest are listed as not identified yet.
- **Weapon damage:** left unknown for special weapons whose damage isn't derivable (for example Thunderfury).
- **Classic ranges:** Classic "min to max" effects render as the game shows them ("Restores 1350 to 2250 mana").
- **Comparison rules:**
  - Items are matched by ID, or by a unique name when Forever reissued the item under a new ID.
  - Classic equip effects that Forever turned into stats count as the same ("Restores 2 mana per 5 sec." = +2 MP5). Percent chances that became ratings are shown side by side as a real change.
  - Armor is compared as base plus bonus.
  - Wording alone never counts as a change.
- **Not included:** drop sources and vendors aren't in the client files, so they aren't listed. Items requiring a level above 60 exist in the client files but can't be used; they sort last and say so.

## Beta to launch

The site follows the WoW Forever beta now and switches to the live game by itself:
- **Finding builds:** `discover_builds()` in `pipeline/build_data.py` treats every `1.x` client with a minor version of 60 or more as Forever, so a release that bumps the version number (say 1.61) is still found.
- **Phase:** if a Forever build exists under a live (non-test) wago.tools product, the phase becomes `live`. From then on only live builds are used, plus the beta builds from before launch as changelog history, so a later PTR never replaces what players have.
- **Wording:** the phase is written to `meta.json`. The header badge, hero and data notes follow it; the rest of the wording is neutral ("game client", "game build").
- **Override:** if wago.tools names the live product unexpectedly, set the repository variable `FOREVER_PHASE=live` (or `beta`) for the data job.
- **Saved builds and share links:** they remember the build they were made on, so after launch they flag any talent that changed at release.

## Search engines

The app is a single-page app, so `functions/_middleware.ts` sends every page address through `server/pages.ts` before it reaches the browser:
- **Status codes:** real 404s for unknown pages and missing items or builds, and 301s to the canonical address (for example `/talents` → `/talents/warrior`). `www.` and the old `pages.dev` address redirect to the domain.
- **Head tags:** a search-friendly title (the same one the app sets in the browser), description, canonical link, social preview tags and JSON-LD (site info, breadcrumbs).
- **Private pages:** account, sign-in, admin and similar get `noindex`, as do preview deployments.
- **Pre-rendered content:** item pages (tooltip text), class pages (all talents with tooltips), build pages, the builds list and the Classic comparison carry their main content as plain HTML. The app replaces it as soon as it starts.
- **Sitemaps:** `sitemap.xml` is an index of `sitemap-pages.xml` and `sitemap-items.xml`, both written at build time from the game data by a Vite plugin (`VITE_SITE_URL`), and `sitemap-builds.xml`, served live from the database.
- **robots.txt:** `public/robots.txt` keeps crawlers out of private pages, endless per-build addresses and query-string variants, and lets the AdSense crawler see everything. Cloudflare's managed robots.txt (AI crawl control) is added in front of it on the domain. It blocks AI training crawlers and doesn't affect search.

## Bug reports

The "Report a bug" button opens a short form, which sends the message, the page address, browser, screen size and the game build shown:
- **Where it is:** in the header on desktop, in the menu on smaller screens, and in the footer.
- **Wrong data:** a "Spotted wrong game data?" link on talent and item pages opens it pre-set to "Wrong game data".
- **Storage:** reports go to the `feedback` table and show up on the moderation page (`/admin`), where they can be marked resolved.
- **Email copy:** set `FEEDBACK_EMAIL` on the Pages project to also get each report by email.
- **Spam and retention:** spam is limited per IP and by a hidden honeypot field. Resolved reports are deleted after 30 days, and every report after 12 months, as the privacy policy says.

## News

`/news` lists headlines about WoW Forever from Wowhead, MMO-Champion, Blizzard Watch, Massively Overpowered, PC Gamer, buffed.de and Mein-MMO. The home page shows the latest six.

- **How it's sourced:** `.github/workflows/refresh-news.yml` runs `scripts/fetch-news.ts` every 2 hours. It reads each publisher's public RSS/Atom feed, the format they offer for syndication, and nothing else: it never fetches the article pages. It keeps items whose headline names WoW Forever or that the publisher filed under a "Forever" category, then posts them to `POST /api/internal/news` (secured by `NOTIFY_SECRET`). The feeds are parsed in the Action, not in the Pages Function, so the site stays within the Workers CPU limits. Locally: `npm run news` (or `npm run news -- --dry` to only print).
- **What's stored and shown:** the headline, the link, the publisher's name and the publication date. No article text, no feed summaries, no images and no publisher logos. The server re-checks every item: a known source, a link on that source's own domain, and a title of at most 240 characters. Tracking parameters are stripped from links.
- **What we add:** topic tags and links to the class talent pages, from our own keyword rules (`NEWS_TOPICS` in `shared/news.ts`).
- **Why this is on the safe side of copyright:**
  - Nothing of the articles is reproduced beyond the headline, and every headline links to the original, which sends readers to the publisher.
  - Headlines alone are generally not protected in the US. In the EU, the press publishers' right (Art. 15 DSM Directive; §87f UrhG in Germany) explicitly allows "individual words or very short extracts".
  - The news page carries no ads, so the headlines aren't monetized directly.
  - It's still a legal judgment call, not a guarantee. If you want certainty for your jurisdiction, ask a lawyer, or ask the publishers for permission.
- **Opt-out:**
  - To remove one headline, moderators use its *Hide* button on the News page; it's undone from the moderation page, and the next fetch never brings it back.
  - To stop a publisher entirely, delete its entry from `NEWS_SOURCES` in `shared/news.ts`.
  - The News page asks publishers to get in touch through the imprint.
- **Politeness:** one request per feed per run with an identifying User-Agent (`ForeverForgeNews/1.0 (+https://wow-forever-forge.com/news)`). A feed that refuses automated clients is skipped, not worked around; Massively Overpowered currently answers 403. Blizzard's own news site and Icy Veins have no public feed, so they aren't included and aren't scraped.

## Logo

The crest (an eternal flame on an anvil, in a gold-rimmed shield) is original artwork defined once in `shared/logo.ts`. `node scripts/write-logo.ts` copies it into the header in `index.html` and `public/favicon.svg`, and renders `public/apple-touch-icon.png` (home-screen icon) and `public/logo-email.png` (email header; email clients don't show SVG). Share images use it directly.

## Share codes

A build is the ordered list of points spent, so a link also records the leveling order. Each point is its talent's trait node ID in 3 base64url characters (`shared/code.ts`). Talent IDs are stable across builds, so old links keep working. `?b=<build>` records the beta build a link was made on. When an older link is opened, the page lists talents in that build that changed since.

## Deploy (Cloudflare Pages + D1)

1. `npx wrangler d1 create forever-forge`, then put the printed `database_id` in `wrangler.toml`.
2. `npm run db:migrate` to create the tables in the remote database.
3. Create the Pages project, either by connecting the Git repo (build command `npm run build`, output `dist`) or with `npm run deploy`. Bind the D1 database as `DB` under Settings → Bindings. SPA fallback is automatic because there's no `404.html`.
4. Add `wow-forever-forge.com` as a custom domain.

### Before launch

`npm run build` prints a launch checklist, and `npm run deploy` refuses to deploy until it passes. It checks for:

- **Operator details** in `src/views/legal.ts`. An Impressum is legally required for commercial sites in Germany and Austria. Have the privacy policy reviewed.
- **The D1 `database_id`** in `wrangler.toml`.
- **AdSense:** once the site is approved, set the `VITE_ADSENSE_*` env vars (see `.env.example`). `dist/ads.txt` is then generated automatically.

These can't be checked from the code:

- **Email:** set `RESEND_API_KEY` and `MAIL_FROM` as encrypted variables on the Pages project (`npx wrangler pages secret put RESEND_API_KEY`), and verify the sending domain in Resend. Without them, signup still works but no confirmation or reset emails go out.
- **Change alerts:**
  1. Generate a random secret, e.g. `openssl rand -hex 32`.
  2. Set it as `NOTIFY_SECRET` on the Pages project.
  3. Add GitHub repository secrets `NOTIFY_SECRET` (same value) and `SITE_URL` (`https://wow-forever-forge.com`).

  After each data update, the workflow waits for the deploy and then calls `POST /api/internal/notify`.
- **Consent:** enable AdSense's certified consent message (Privacy & messaging → European regulations) so EU visitors get a GDPR prompt.
- **First admin:** `npm run make-admin -- <you> --remote`.

## Ideas for later

- Per-race base stats in the gear sandbox, if a future client ships them. Today they're entered by hand.
- Set bonuses in the gear sandbox (`ItemSet` and `ItemSetSpell` are in the client).
- Zone level ranges in the leveling planner, once the client has them.
