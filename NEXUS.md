# forge

## About
Forever Forge is a theorycrafting and build site for World of Warcraft: Forever, live at
https://wow-forever-forge.com since 2026-10-01 (game launch 2026-11-04). It tracks the beta client: every
talent diffed vs Classic Era and vs each beta build, plus a talent calculator, community builds with accounts,
item database, leveling planner, gear sandbox, professions, flight map and news. Stack: Vite + TypeScript
frontend without a framework (`src/`), Cloudflare Pages Functions + D1 API (`functions/`, `server/`,
`migrations/`), Python stdlib data pipeline (`pipeline/`) reading wago.tools DB2 exports. Commands:
`npm install`, `npm run data`, `npm run dev` (web :5173 + API :8788), `npm test` (vitest), `npm run build` (prints
the launch checklist); every push to main deploys automatically. Rule: never extrapolate game numbers; show
"?" or "not in client yet".

## Status
- Last feature commit 2026-10-12: gear sandbox character sheet with editable rules of thumb. The GitHub data
  job commits "Update game data" every 4 hours (latest local one 2026-10-10), so pull before working; this
  clone may be behind origin.
- Working tree is clean. Production runs on Cloudflare Pages + D1 with Resend email, the news job every 2
  hours, and Ko-fi links (since 2026-10-03).
- AdSense applied 2026-10-01 and awaiting review; `.env.production` still sets `VITE_AD_FALLBACK` (house
  promos) and has no ad slot IDs.
- Promotion is waiting on the r/wowforever mods to approve a removed Reddit post (as of 2026-10-03; current
  state unknown).

## Todo
- [ ] Prepare for launch on 2026-11-04: confirm the pipeline switches the phase to `live` when a live Forever
      product appears on wago.tools, and know the `FOREVER_PHASE` override
- [ ] Once AdSense is approved: create the ad units, add `VITE_ADSENSE_SLOT_LEADERBOARD/_RECTANGLE/_RAIL` to
      `.env.production`, remove `VITE_AD_FALLBACK`, and turn on the EU consent message
- [ ] Check Google Search Console: that all sitemaps are fetched and pages indexed (if not, look at Cloudflare
      Security events for Googlebot)
- [ ] Release-week promotion: Reddit post leading with talent numbers (once mods approve), class Discords,
      small WoW creators
- [ ] Gear sandbox: add set bonuses from `ItemSet` / `ItemSetSpell` (README "Ideas for later")
- [ ] Gear sandbox: per-race base stats if a future client ships them (entered by hand today)
- [ ] Leveling planner: zone level ranges once the client has them
- [ ] Responsive check of the new gear sandbox and flight map at 320/375/768/1024/1280 px, signed in and signed out
- [x] Flight map and route planner from client zone overlays (2026-10-03)
- [x] Gear sandbox character sheet with editable rules of thumb (2026-10-12)
