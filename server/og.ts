// The site's social preview card (Open Graph image): an SVG template rendered to PNG by
// scripts/write-og-default.ts into public/og-default.png.

import { logoMark } from "../shared/logo";

export const CARD_W = 1200;
export const CARD_H = 630;

/** The workshop palette, kept in sync with src/style.css. */
const C = {
  soot: "#0f0c0a",
  iron: "#221d19",
  brass: "#c9a25a",
  brassDark: "#6b5126",
  ember: "#ff7a1a",
  emberHot: "#ffb547",
  cream: "#f6ecda",
  muted: "#b8a993",
};

/** The site-wide card every page shares. */
export function defaultCardSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="Inter">
  <defs>
    <radialGradient id="forge" cx=".78" cy="1.05" r=".75">
      <stop offset="0" stop-color="${C.ember}" stop-opacity=".55"/>
      <stop offset=".45" stop-color="#7a2a08" stop-opacity=".25"/>
      <stop offset="1" stop-color="${C.soot}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="${C.ember}" stop-opacity=".45"/>
      <stop offset="1" stop-color="${C.ember}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff1c9"/>
      <stop offset=".45" stop-color="${C.emberHot}"/>
      <stop offset="1" stop-color="${C.ember}"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="${C.soot}"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#forge)"/>
  <rect x="14" y="14" width="${CARD_W - 28}" height="${CARD_H - 28}" rx="10" fill="none" stroke="${C.brassDark}" stroke-width="3"/>
  ${[[34, 34], [CARD_W - 34, 34], [34, CARD_H - 34], [CARD_W - 34, CARD_H - 34]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${C.brass}"/>`).join("")}
  <circle cx="930" cy="290" r="230" fill="url(#halo)"/>
  <svg x="790" y="150" width="280" height="280" viewBox="0 0 48 48">${logoMark("og")}</svg>
  <g transform="translate(80 120)">
    <text x="0" y="0" font-size="24" font-weight="700" letter-spacing="7" fill="${C.emberHot}">WOW FOREVER CRAFTING COMPANION</text>
    <text x="0" y="96" font-size="80" font-weight="700" fill="${C.cream}">Every recipe.</text>
    <text x="0" y="190" font-size="80" font-weight="700" fill="url(#hot)">Every reagent.</text>
    <text x="0" y="262" font-size="27" fill="${C.muted}">Reagents, skill-up colors, tools and recipe items</text>
    <text x="0" y="300" font-size="27" fill="${C.muted}">for every profession, from the game files.</text>
  </g>
  <text x="80" y="${CARD_H - 62}" font-size="26" font-weight="600" letter-spacing="4" fill="${C.brass}">FOREVER FORGE · wow-forever-forge.com</text>
</svg>`;
}

/** Minimal slice of @resvg/resvg-wasm's API, so tests and the worker can inject it. */
export interface ResvgModule {
  Resvg: new (
    svg: string,
    opts: { font: { fontBuffers: Uint8Array[]; defaultFontFamily: string; loadSystemFonts?: boolean }; fitTo?: { mode: "width"; value: number } },
  ) => { render(): { asPng(): Uint8Array } };
}

export function renderPng(resvg: ResvgModule, svg: string, fonts: Uint8Array[]): Uint8Array {
  const r = new resvg.Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: "Inter", loadSystemFonts: false } });
  return r.render().asPng();
}
