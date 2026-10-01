// Ad slots. Each slot reserves its size up front so pages don't jump when ads load.
//
// Configure Google AdSense with build-time env vars (e.g. in .env.local or the
// Cloudflare Pages settings):
//   VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
//   VITE_ADSENSE_SLOT_LEADERBOARD=1234567890
//   VITE_ADSENSE_SLOT_RECTANGLE=1234567890
//   VITE_ADSENSE_SLOT_RAIL=1234567890        (optional: 300×600 sidebar; defaults to the rectangle unit)
//
// Placement: a sticky 300×600 sidebar next to long, interactive pages (wide screens only), an
// in-list unit every few dozen rows of long lists, and at most one banner per page otherwise.
// On phones, enable AdSense "anchor ads" (Auto ads settings) for a policy-compliant sticky banner.
// Without them, slots show a labeled placeholder at the ad's real size, so you can see where
// ads will go. Set VITE_AD_FALLBACK=house to show promos for the site's own features instead
// (e.g. while AdSense is still reviewing the site).

import { currentUser } from "./session";

type Kind = "leaderboard" | "rectangle" | "rail";

const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;
const FALLBACK = import.meta.env.VITE_AD_FALLBACK === "house" ? "house" : "placeholder";
const SLOTS: Record<Kind, string | undefined> = {
  leaderboard: import.meta.env.VITE_ADSENSE_SLOT_LEADERBOARD,
  rectangle: import.meta.env.VITE_ADSENSE_SLOT_RECTANGLE,
  rail: import.meta.env.VITE_ADSENSE_SLOT_RAIL || import.meta.env.VITE_ADSENSE_SLOT_RECTANGLE,
};

const SIZE: Record<Kind, string> = {
  leaderboard: `<span class="ad-size wide">728 × 90 leaderboard</span><span class="ad-size narrow">320 × 100 mobile banner</span>`,
  rectangle: `<span class="ad-size">300 × 250 rectangle</span>`,
  rail: `<span class="ad-size">300 × 600 half page</span>`,
};

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export function loadAdScript() {
  if (!CLIENT || document.querySelector("script[data-adsense]")) return;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.dataset.adsense = "";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
  document.head.append(s);
}

export function adSlot(kind: Kind, extraClass = ""): string {
  const slot = SLOTS[kind];
  if (CLIENT && slot) {
    const format = {
      leaderboard: `data-ad-format="horizontal" data-full-width-responsive="true"`,
      rectangle: `data-ad-format="rectangle"`,
      rail: `data-ad-format="vertical"`,
    }[kind];
    return `<aside class="ad ad-${kind} ${extraClass}" aria-label="Advertisement">
        <span class="ad-label">Advertisement</span>
        <ins class="adsbygoogle" style="display:block" data-ad-client="${CLIENT}" data-ad-slot="${slot}" ${format}></ins>
      </aside>`;
  }
  if (FALLBACK === "placeholder") {
    const size = SIZE[kind];
    return `<aside class="ad ad-${kind} ad-placeholder ${extraClass}" aria-label="Ad space (placeholder)">
        <span class="ad-label">Advertisement</span>
        <div class="ad-box"><b>Ad space</b>${size}<span class="ad-note">Google AdSense · responsive</span></div>
      </aside>`;
  }
  return `<aside class="ad ad-${kind} house ${extraClass}" data-house="${kind}" aria-label="Forever Forge"></aside>`;
}

/** A sticky 300×600 sidebar ad beside `content` on wide screens (hidden below 1280px, where the
 * page's in-list ads take over). */
export function withRail(content: string): string {
  return `<div class="rail-layout"><div class="rail-main">${content}</div><aside class="rail-ad">${adSlot("rail")}</aside></div>`;
}

/** Renders `items` with an in-list banner after every `every` items (never after the last one);
 * `offset` continues the count across "show more" pages so ads stay evenly spaced. */
export function withListAds<T>(items: T[], render: (item: T) => string, every: number, offset = 0): string {
  return items
    .map((item, i) => render(item) + ((offset + i + 1) % every === 0 && i < items.length - 1 ? adSlot("leaderboard", "in-list") : ""))
    .join("");
}

interface Promo {
  title: string;
  text: string;
  href: string;
  cta: string;
  signedOutOnly?: boolean;
}

const PROMOS: Promo[] = [
  { title: "Save your builds", text: "Create a free account to keep your builds and share them.", href: "/signup", cta: "Create account", signedOutOnly: true },
  { title: "Community builds", text: "Browse the top-rated builds for every class and rate your favorites.", href: "/builds", cta: "Browse builds" },
  { title: "What changed this build?", text: "Every game build is diffed talent by talent.", href: "/changes", cta: "See changes" },
  { title: "Classic → Forever", text: "Word-by-word comparison of every talent against Classic Era.", href: "/changes/classic/warrior", cta: "Compare" },
];

let rotation = Math.floor(Math.random() * PROMOS.length);

/** Activate every unfilled slot under `root`. Call after rendering a view. */
export async function fillAds(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("ins.adsbygoogle:not([data-ad-status])").forEach(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* ad blocked or script not ready; the reserved space just stays empty */
    }
  });
  const houses = root.querySelectorAll<HTMLElement>("[data-house]:empty");
  if (!houses.length) return;
  const signedIn = !!(await currentUser());
  // Don't advertise the page you're already on.
  const here = location.pathname.split("/")[1];
  const pool = PROMOS.filter((p) => !(p.signedOutOnly && signedIn) && p.href.split("/")[1] !== here);
  houses.forEach((el) => {
    const p = pool[rotation++ % pool.length];
    el.innerHTML = `<a class="house-ad" href="${p.href}" data-link>
        <span class="house-text"><strong>${p.title}</strong><span>${p.text}</span></span>
        <span class="btn small">${p.cta}</span>
      </a>`;
  });
}
