// Pre-launch checklist: warns about things that must be done before going live.
// Runs after `npm run build`; exits 1 with --strict (use in the production deploy).
import { existsSync, readFileSync } from "node:fs";

// Vite reads .env files too; mirror that for the AdSense client id.
for (const file of [".env", ".env.production", ".env.local", ".env.production.local"]) {
  const url = new URL(`../${file}`, import.meta.url);
  if (!existsSync(url)) continue;
  for (const line of readFileSync(url, "utf8").split("\n")) {
    const m = /^\s*(VITE_ADSENSE_CLIENT|VITE_AD_FALLBACK)\s*=\s*(\S+)/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const problems = [];
const legal = readFileSync(new URL("../src/views/legal.ts", import.meta.url), "utf8");
if (/\[(Full name|Street|contact email|Postal code)/.test(legal)) problems.push("Operator details in src/views/legal.ts are still placeholders (imprint + privacy policy).");
const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
if (wrangler.includes("00000000-0000-0000-0000-000000000000")) problems.push("wrangler.toml still has the placeholder D1 database_id.");
// Running without ads on purpose (house promos) is fine.
if (!process.env.VITE_ADSENSE_CLIENT && process.env.VITE_AD_FALLBACK !== "house") problems.push("VITE_ADSENSE_CLIENT is not set: ad slots show \"Ad space\" placeholders (or house promos with VITE_AD_FALLBACK=house) and no ads.txt is generated.");
else if (process.env.VITE_ADSENSE_CLIENT && !existsSync(new URL("../dist/ads.txt", import.meta.url))) problems.push("dist/ads.txt is missing.");

if (problems.length) {
  console.warn(`\nLaunch checklist (${problems.length}):\n${problems.map((p) => `  • ${p}`).join("\n")}\n`);
  console.warn("With ads, also enable the AdSense consent message. Bug reports are emailed when RESEND_API_KEY,");
  console.warn("MAIL_FROM and FEEDBACK_EMAIL are set on the Pages project.\n");
  if (process.argv.includes("--strict")) process.exit(1);
} else {
  console.log("Launch checklist: all good.");
}
