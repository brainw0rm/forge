// The site's social preview card (Open Graph image): an SVG template rendered to PNG by
// scripts/write-og-default.ts into public/og-default.png.

export const CARD_W = 1200;
export const CARD_H = 630;

/** The site palette (WoW Forever's night sky and the game's gold), kept in sync with src/style.css. */
const C = {
  night: "#060a17",
  navy: "#13204a",
  dusk: "#4a3a6e",
  glow: "#e0894a",
  gold: "#ffd100",
  goldSoft: "#f3d98b",
  metal: "#d9ad4f",
  metalLo: "#7a5418",
  muted: "#aab1c7",
};

/** The site-wide card every page shares. */
export function defaultCardSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="Inter">
  <defs>
    <radialGradient id="sky" cx=".5" cy="-.1" r="1">
      <stop offset="0" stop-color="${C.navy}"/><stop offset=".7" stop-color="${C.night}"/>
    </radialGradient>
    <radialGradient id="dusk" cx=".5" cy="1.15" r=".75">
      <stop offset="0" stop-color="${C.glow}" stop-opacity=".45"/><stop offset=".5" stop-color="${C.dusk}" stop-opacity=".35"/><stop offset="1" stop-color="${C.night}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff1bf"/><stop offset=".3" stop-color="${C.metal}"/><stop offset=".55" stop-color="${C.metalLo}"/><stop offset=".8" stop-color="${C.metal}"/><stop offset="1" stop-color="${C.metalLo}"/>
    </linearGradient>
    <linearGradient id="goldText" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6d0"/><stop offset=".5" stop-color="#f5c84f"/><stop offset="1" stop-color="#b07a1c"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#sky)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#dusk)"/>
  <rect x="12" y="12" width="${CARD_W - 24}" height="${CARD_H - 24}" rx="10" fill="none" stroke="url(#edge)" stroke-width="5"/>
  <rect x="18" y="18" width="${CARD_W - 36}" height="${CARD_H - 36}" rx="7" fill="none" stroke="#000" stroke-width="2"/>
  <text x="${CARD_W - 80}" y="140" text-anchor="end" font-size="22" font-weight="700" letter-spacing="14" fill="url(#goldText)">FOREVER</text>
  <text x="${CARD_W - 80}" y="196" text-anchor="end" font-size="56" font-weight="700" letter-spacing="8" fill="url(#goldText)">FORGE</text>
  <g transform="translate(80 128)">
    <text x="0" y="0" font-size="24" font-weight="700" letter-spacing="7" fill="${C.goldSoft}">WOW FOREVER CRAFTING COMPANION</text>
    <text x="0" y="96" font-size="80" font-weight="700" fill="#f7efdc">Every recipe.</text>
    <text x="0" y="190" font-size="80" font-weight="700" fill="url(#goldText)">Every reagent.</text>
    <text x="0" y="262" font-size="27" fill="${C.muted}">Reagents, skill-up colors, recipe sources</text>
    <text x="0" y="300" font-size="27" fill="${C.muted}">for every profession, from the game files.</text>
  </g>
  <text x="80" y="${CARD_H - 62}" font-size="26" font-weight="600" letter-spacing="4" fill="${C.gold}">wow-forever-forge.com</text>
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
