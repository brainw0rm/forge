// Ko-fi donations. Set VITE_KOFI_URL (e.g. https://ko-fi.com/yourname) to show the support links;
// without it they stay hidden. Plain links only: no Ko-fi widget script, so nothing loads from Ko-fi
// until someone clicks.

export const KOFI_URL = (import.meta.env.VITE_KOFI_URL as string | undefined) || "";

/** Point the [data-kofi] links in the page shell at the Ko-fi page and show them. */
export function showSupportLinks() {
  if (!KOFI_URL) return;
  document.querySelectorAll<HTMLAnchorElement>("a[data-kofi]").forEach((a) => {
    a.href = KOFI_URL;
    a.hidden = false;
  });
}
