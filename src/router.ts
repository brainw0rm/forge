// Client-side navigation. main.ts listens for "ff:navigate" and renders the route.

export function navigate(url: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new Event("ff:navigate"));
}
