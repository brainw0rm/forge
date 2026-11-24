// Writes the monogram from shared/logo.ts into public/favicon.svg and the PNG icons (home-screen icon,
// email header), so they all stay identical. Run: node scripts/write-logo.ts

import { readFileSync, writeFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { logoMark, logoSvg } from "../shared/logo.ts";

const root = new URL("../", import.meta.url);
writeFileSync(new URL("public/favicon.svg", root), `${logoSvg("fav")}\n`);

// PNGs: email clients don't show SVG, and phones want a square home-screen icon on a solid background.
await initWasm(readFileSync(new URL("node_modules/@resvg/resvg-wasm/index_bg.wasm", root)));
const png = (svg: string, width: number) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
writeFileSync(new URL("public/logo-email.png", root), png(logoSvg("png"), 96));
const touch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#060a17"/><g transform="translate(4.8 4.8) scale(.8)">${logoMark("touch")}</g></svg>`;
writeFileSync(new URL("public/apple-touch-icon.png", root), png(touch, 180));
console.log("Wrote public/favicon.svg, logo-email.png and apple-touch-icon.png.");
