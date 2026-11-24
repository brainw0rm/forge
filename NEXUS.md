# forge

## About
Forever Forge is a crafting companion for World of Warcraft: Forever at https://wow-forever-forge.com: every
recipe of every profession from the game client (reagents, skill-up colors, tools, stations, cooldowns, recipe
items, Classic Era differences), profession pages with "your skill" coloring, a crafting list with raw-material
breakdown, and the item database. Relaunched as crafting-only on 2026-11-24 (it was a talent/build site before).
Stack: Vite + TypeScript frontend without a framework (`src/`, mobile-first CSS), Cloudflare Pages Functions
(`functions/`, `server/`: SEO page rendering + bug-report API on D1), Python stdlib data pipeline (`pipeline/`)
reading wago.tools DB2 exports. Commands: `npm install`, `npm run data`, `npm run dev`, `npm test`, `npm run
build`; every push to main deploys. Rule: never extrapolate game numbers; show "?" or "not in the client data".

## Status
- 2026-11-24: crafting relaunch. Talents, builds, accounts, gear sandbox, sets, flight map, leveling, legacy,
  news and the 3D viewer were removed; their addresses answer 410 Gone. Look: "artisan's workshop" (iron, ember,
  brass, parchment recipe cards).
- The D1 database still holds the old account tables (users, sessions, builds, ratings, watches, news); only
  `feedback` and `auth_attempts` (rate limit) are used now. Privacy page tells former users to email for deletion.
- Runs on the Cloudflare Workers Free plan; AdSense closed (house promos). Contact: brainwormbrood@gmail.com.
- Repo is public: commit emails must be the GitHub noreply address on every machine.

## Todo
- [ ] Decide whether to delete the old account data from D1 (drop the account/build tables with a migration)
- [ ] Remove the Resend/NOTIFY secrets that only served accounts and alerts (NOTIFY_SECRET on Pages, SITE_URL and
      NOTIFY_SECRET repository secrets); keep RESEND_API_KEY/MAIL_FROM/FEEDBACK_EMAIL for bug reports
- [ ] Search Console: submit the new sitemap, watch the 410s drop out of the index
- [ ] Recipe sources (trainer/vendor/drop) if a client or allowed source ships them
- [ ] Skill-up path planner (cheapest recipes from skill A to B)
- [x] Crafting companion relaunch with workshop look, mobile-first (2026-11-24)
