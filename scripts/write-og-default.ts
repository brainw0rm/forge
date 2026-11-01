// Renders the site-wide preview card (server/og.ts defaultCardSvg) to public/og-default.png.
// Run after changing the card or the logo: node --import ./scripts/ts-resolve.mjs scripts/write-og-default.ts

import { readFileSync, writeFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { defaultCardSvg, renderPng, type ResvgModule } from "../server/og.ts";

const root = new URL("../", import.meta.url);
await initWasm(readFileSync(new URL("node_modules/@resvg/resvg-wasm/index_bg.wasm", root)));
const fonts = ["400Regular", "600SemiBold", "700Bold"].map((w) => new Uint8Array(readFileSync(new URL(`public/og/Inter_${w}.ttf`, root))));
writeFileSync(new URL("public/og-default.png", root), renderPng({ Resvg } as unknown as ResvgModule, defaultCardSvg(), fonts));
console.log("Wrote public/og-default.png");
