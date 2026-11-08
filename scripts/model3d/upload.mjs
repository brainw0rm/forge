// Upload the built 3D set models (public/models) to the R2 bucket the site loads them from.
// The models are Blizzard assets, so they stay out of the public repo (see README "3D set viewer").
// Usage: node scripts/model3d/upload.mjs [file ...]      (default: every model, then index.json)
// One-time bucket setup: node scripts/model3d/upload.mjs --setup <zone id>
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const BUCKET = "forever-forge-models";
const DOMAIN = "models.wow-forever-forge.com";
const DIR = "public/models";
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });

if (process.argv[2] === "--setup") {
  const zone = process.argv[3];
  if (!zone) {
    console.error("Usage: node scripts/model3d/upload.mjs --setup <zone id of wow-forever-forge.com>");
    process.exit(1);
  }
  wrangler("r2", "bucket", "create", BUCKET);
  wrangler("r2", "bucket", "cors", "set", BUCKET, "--file", "scripts/model3d/r2-cors.json", "--force");
  wrangler("r2", "bucket", "domain", "add", BUCKET, "--domain", DOMAIN, "--zone-id", zone, "--min-tls", "1.2", "--force");
  process.exit(0);
}

const named = process.argv.slice(2);
const models = named.length ? named : readdirSync(DIR).filter((f) => f.endsWith(".glb"));
// index.json goes last, so the site never lists a model that isn't there yet.
for (const file of [...models.filter((f) => f !== "index.json"), "index.json"]) {
  const glb = file.endsWith(".glb");
  wrangler(
    "r2", "object", "put", `${BUCKET}/${file}`, "--remote", "--file", `${DIR}/${file}`,
    "--content-type", glb ? "model/gltf-binary" : "application/json",
    // Rebuilt models keep their name, so they are cached for a day, the index for five minutes.
    "--cache-control", glb ? "public, max-age=86400" : "public, max-age=300",
  );
}
