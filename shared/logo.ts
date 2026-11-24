// The Forever Forge monogram for the favicon and home-screen icon: a serif F in game gold inside a
// gold-edged night-blue tile. The site header uses the typed wordmark instead (index.html).
// Regenerate the icons with `node scripts/write-logo.ts`.

/** Inner markup for a 48×48 viewBox. `id` prefixes gradient ids so several marks can share a page. */
export function logoMark(id = "ff"): string {
  return `<defs>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2=".3" y2="1">
      <stop offset="0" stop-color="#fff4c4"/><stop offset=".35" stop-color="#f2c75a"/><stop offset=".6" stop-color="#9c6b16"/><stop offset="1" stop-color="#e8b84a"/>
    </linearGradient>
    <linearGradient id="${id}-letter" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6d0"/><stop offset=".5" stop-color="#f5c84f"/><stop offset="1" stop-color="#b07a1c"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="46" height="46" rx="7" fill="url(#${id}-gold)"/>
  <rect x="3.2" y="3.2" width="41.6" height="41.6" rx="5" fill="#0a1230"/>
  <rect x="4.6" y="4.6" width="38.8" height="38.8" rx="4" fill="none" stroke="#f2c75a" stroke-opacity=".35" stroke-width=".8"/>
  <path fill="url(#${id}-letter)" stroke="#2a1a04" stroke-width=".7" stroke-linejoin="round"
    d="M13 10H35V18.2H32.6C32.2 15.6 30.9 14.7 28.4 14.7H22.2V22.3H26.8C28.4 22.3 29 21.5 29.2 19.9H31.4V28.9H29.2C29 27.3 28.4 26.5 26.8 26.5H22.2V34.1C22.2 35.3 23.1 35.9 25 36.1V38H13V36.1C14.8 35.9 15.6 35.3 15.6 34.1V13.9C15.6 12.7 14.8 12.1 13 11.9Z"/>`;
}

/** A standalone SVG file (favicon, previews). */
export const logoSvg = (id = "ff") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${logoMark(id)}</svg>`;
