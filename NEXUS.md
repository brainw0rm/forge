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
- 2026-11-01: the user is taking the site offline and will relaunch later. Both scheduled GitHub workflows
  (Refresh game data, Refresh news) are disabled; re-enable with `gh workflow enable`. The
  wowforeverforge@gmail.com account is being deleted; a new contact address comes with the relaunch.
- Production (Cloudflare Pages + D1, Resend, Ko-fi links) is being shut down by the user; see the relaunch todo.

## Todo
- [ ] Relaunch: new contact address in `src/views/legal.ts` (imprint/privacy) and the `FEEDBACK_EMAIL` secret;
      recreate the Pages project, D1 (migrations, or restore the backup) and secrets (APP_URL, NOTIFY_SECRET,
      RESEND_API_KEY, MAIL_FROM); point the domain at Cloudflare again; `gh workflow enable` both workflows;
      re-add the site in Search Console and AdSense; refresh the data first (`npm run data`)
- [ ] Check GitHub billing (Settings → Billing): Actions were blocked 2026-10-21 to 2026-10-31
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
