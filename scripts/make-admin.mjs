// Give a user the moderator (admin) role.
// Usage: node scripts/make-admin.mjs <username> [--remote]
import { execFileSync } from "node:child_process";

const [username] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!username || !/^[A-Za-z0-9_-]{3,24}$/.test(username)) {
  console.error("Usage: node scripts/make-admin.mjs <username> [--remote]");
  process.exit(1);
}
const where = process.argv.includes("--remote") ? "--remote" : "--local";
execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "forever-forge", where, "--command", `UPDATE users SET role = 'admin' WHERE username = '${username}' COLLATE NOCASE`],
  { stdio: "inherit" },
);
