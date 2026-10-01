// Writes the logo from shared/logo.ts into public/favicon.svg, the header of index.html and PNG
// icons (home-screen icon, email header), so they all stay identical. Run: node scripts/write-logo.ts

import { readFileSync, writeFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { logoMark, logoSvg } from "../shared/logo.ts";

const root = new URL("../", import.meta.url);
writeFileSync(new URL("public/favicon.svg", root), `${logoSvg("fav")}\n`);

const indexUrl = new URL("index.html", root);
const html = readFileSync(indexUrl, "utf8");
const mark = `<svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true"><!-- logo:start -->${logoMark("hdr")
  .replace(/\n\s*/g, "")}<!-- logo:end --></svg>`;
const next = html.replace(/<svg class="logo-mark"[\s\S]*?<!-- logo:end --><\/svg>|<svg viewBox="0 0 32 32" aria-hidden="true">[\s\S]*?<\/svg>/, mark);
if (next === html && !html.includes("<!-- logo:start -->")) throw new Error("logo placeholder not found in index.html");
writeFileSync(indexUrl, next);
// PNGs: email clients don't show SVG, and phones want a square home-screen icon on a solid background.
await initWasm(readFileSync(new URL("node_modules/@resvg/resvg-wasm/index_bg.wasm", root)));
const png = (svg: string, width: number) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
writeFileSync(new URL("public/logo-email.png", root), png(logoSvg("png"), 96));
const touch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0b1530"/><g transform="translate(4.8 4.8) scale(.8)">${logoMark("touch")}</g></svg>`;
writeFileSync(new URL("public/apple-touch-icon.png", root), png(touch, 180));
console.log("Wrote public/favicon.svg, the index.html header logo, logo-email.png and apple-touch-icon.png.");
