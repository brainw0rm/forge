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
- 2026-11-01: the site stays online in standby on the Cloudflare Workers Free plan (the user is cancelling
  Workers Paid): `public/_routes.json` keeps static files out of the Functions, `OG_IMAGES = "static"` in
  `wrangler.toml` serves one fixed preview card. AdSense is closed and removed from the build. Contact address
  is now brainwormbrood@gmail.com (imprint, privacy page).
- 2026-11-01: repo being made public (free unlimited Actions). History was checked for secrets; commit emails
  must be the GitHub noreply address on every machine, including nexus's snapshot refs (`refs/nexus/work/*`).
- Password hashing (PBKDF2, ~65 ms CPU) exceeds the free plan's 10 ms. The user chose to just try sign-in after
  switching plans; if it fails, pause sign-in/sign-up with a clear message or go back to Workers Paid.
- Both GitHub jobs are enabled again; news runs every 6 hours instead of 2.

## Todo
- [ ] Workers Paid and Images/Stream cancelled 2026-11-01 (may stay active until the billing period ends). After
      that date, re-run a sign-in check (a made-up username exercises the same PBKDF2 CPU via DUMMY_HASH)
- [ ] Relaunch on Workers Paid: remove `OG_IMAGES` from `wrangler.toml`, news back to every 2 hours, re-add
      AdSense (`VITE_ADSENSE_CLIENT`) and its privacy text appears automatically
- [ ] Check GitHub billing (Settings → Billing): Actions were blocked 2026-10-21 to 2026-10-31
- [ ] Prepare for launch on 2026-11-04: confirm the pipeline switches the phase to `live` when a live Forever
      product appears on wago.tools, and know the `FOREVER_PHASE` override
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
