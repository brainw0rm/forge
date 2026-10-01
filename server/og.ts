// Social preview cards (Open Graph images) for builds: an SVG template rendered to PNG.
// Pure functions: callers provide the data, fonts, icon images and an initialized resvg.

import { logoMark } from "../shared/logo";

export const CARD_W = 1200;
export const CARD_H = 630;

/** Site palette (sampled from the Forever page's colors), kept in sync with src/style.css. */
const C = {
  night: "#0b1530",
  deep: "#172853",
  twilight: "#4f5e96",
  plum: "#a25e8c",
  peach: "#d19a87",
  haze: "#7f8cb4",
  mist: "#b9c3dc",
  cream: "#f5e5cf",
  teal: "#0f6064",
  gold: "#f7b90a",
  aqua: "#5fcfc4",
  rose: "#c87f8c",
  bronze: "#c6af8d",
};

export interface CardTalent {
  name: string;
  rank: number;
  max: number;
  /** data: URI of the 56px icon, or null to draw a placeholder. */
  icon: string | null;
}

export interface CardData {
  className: string;
  classColor: string;
  title: string;
  split: string;
  points: number;
  author?: string;
  rating?: { avg: number; count: number };
  gameBuild: string;
  talents: CardTalent[];
  /** Talents changed in newer game builds since this build was made. */
  changedSince?: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Greedy word wrap using an average glyph width; good enough for Inter at display sizes. */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxChars) line = next;
    else {
      if (line) lines.push(line);
      line = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/…$/, "").slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines;
}

function stars(avg: number, x: number, y: number) {
  return [0, 1, 2, 3, 4]
    .map((i) => {
      const fill = avg >= i + 0.75 ? C.gold : avg >= i + 0.25 ? "url(#half)" : C.deep;
      return `<text x="${x + i * 34}" y="${y}" font-size="32" fill="${fill}">★</text>`;
    })
    .join("");
}

export function cardSvg(d: CardData): string {
  const titleLines = wrap(d.title, 26, 2);
  const icons = d.talents.slice(0, 8);
  const iconSize = 88;
  const gap = 22;
  const iconsX = 80;
  const iconsY = 400;
  const iconRow = icons
    .map((t, i) => {
      const x = iconsX + i * (iconSize + gap);
      const ring = t.rank >= t.max ? C.gold : C.aqua;
      return `<g>
        <rect x="${x - 3}" y="${iconsY - 3}" width="${iconSize + 6}" height="${iconSize + 6}" rx="14" fill="${ring}"/>
        ${
          t.icon
            ? `<image href="${t.icon}" x="${x}" y="${iconsY}" width="${iconSize}" height="${iconSize}" clip-path="url(#r${i})" preserveAspectRatio="xMidYMid slice"/>`
            : `<rect x="${x}" y="${iconsY}" width="${iconSize}" height="${iconSize}" rx="12" fill="${C.deep}"/>`
        }
        <rect x="${x + iconSize - 46}" y="${iconsY + iconSize - 20}" width="54" height="30" rx="8" fill="${C.night}" stroke="${C.deep}"/>
        <text x="${x + iconSize - 19}" y="${iconsY + iconSize + 2}" font-size="18" font-weight="700" fill="${ring}" text-anchor="middle">${t.rank}/${t.max}</text>
      </g>`;
    })
    .join("");
  const clips = icons
    .map((_, i) => `<clipPath id="r${i}"><rect x="${iconsX + i * (iconSize + gap)}" y="${iconsY}" width="${iconSize}" height="${iconSize}" rx="12"/></clipPath>`)
    .join("");
  const meta = [`${d.points} point${d.points === 1 ? "" : "s"}`, `level ${d.points ? 9 + d.points : 1}`, d.author ? `by ${d.author}` : ""]
    .filter(Boolean)
    .join("  ·  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="Inter">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.night}" stop-opacity=".94"/>
      <stop offset=".55" stop-color="${C.night}" stop-opacity=".72"/>
      <stop offset="1" stop-color="${C.night}" stop-opacity=".25"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.night}"/>
      <stop offset=".45" stop-color="${C.deep}"/>
      <stop offset=".72" stop-color="${C.twilight}"/>
      <stop offset=".9" stop-color="${C.plum}"/>
      <stop offset="1" stop-color="${C.peach}"/>
    </linearGradient>
    <linearGradient id="half"><stop offset="0.5" stop-color="${C.gold}"/><stop offset="0.5" stop-color="${C.deep}"/></linearGradient>
    ${clips}
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#sky)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#shade)"/>
  <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="none" stroke="${C.bronze}" stroke-opacity=".45" stroke-width="3"/>
  <rect x="0" y="0" width="12" height="${CARD_H}" fill="${d.classColor}"/>

  <g transform="translate(76 56)">
    <svg width="56" height="56" viewBox="0 0 48 48">${logoMark("og")}</svg>
    <text x="68" y="22" font-size="12.5" font-weight="600" letter-spacing="6.4" fill="${C.bronze}">FOREVER</text>
    <text x="67" y="48" font-size="27" font-weight="600" letter-spacing="4.6" fill="${C.cream}">FORGE</text>
  </g>
  <text x="${CARD_W - 80}" y="96" font-size="22" fill="${C.mist}" text-anchor="end">WoW Forever · build ${esc(d.gameBuild)}</text>

  <text x="80" y="178" font-size="28" font-weight="700" fill="${d.classColor}">${esc(d.className.toUpperCase())}</text>
  ${titleLines.map((l, i) => `<text x="80" y="${238 + i * 64}" font-size="58" font-weight="700" fill="${C.cream}">${esc(l)}</text>`).join("")}
  <text x="80" y="${238 + titleLines.length * 64 + 8}" font-size="26" fill="${C.mist}">${esc(meta)}</text>

  <text x="${CARD_W - 80}" y="236" font-size="84" font-weight="700" fill="${C.gold}" text-anchor="end">${esc(d.split)}</text>
  ${
    d.rating && d.rating.count
      ? `${stars(d.rating.avg, CARD_W - 80 - 5 * 34 - 90, 290)}<text x="${CARD_W - 80}" y="290" font-size="26" fill="${C.cream}" text-anchor="end">${d.rating.avg.toFixed(1)}</text>`
      : ""
  }

  ${iconRow}

  ${
    d.changedSince
      ? `<rect x="80" y="${CARD_H - 88}" width="${420}" height="44" rx="22" fill="${C.rose}" fill-opacity="0.18" stroke="${C.rose}"/>
         <text x="102" y="${CARD_H - 59}" font-size="21" font-weight="600" fill="${C.gold}">${d.changedSince} talent${d.changedSince > 1 ? "s" : ""} changed since this was made</text>`
      : `<text x="80" y="${CARD_H - 58}" font-size="22" fill="${C.haze}">wow-forever-forge.com</text>`
  }
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

/** Talents to feature on a card: the deepest ones the build invested in. */
export function featuredTalents<T extends { tier: number; rank: number; max: number }>(talents: T[], n = 8): T[] {
  return [...talents]
    .filter((t) => t.rank > 0)
    .sort((a, b) => b.tier - a.tier || b.rank / b.max - a.rank / a.max)
    .slice(0, n);
}
