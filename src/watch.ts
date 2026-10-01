// "Watch" toggle buttons for change alerts (class or saved build).

import { api, type Watch } from "./api";
import { navigate } from "./router";
import { currentUser, loginUrl, onUserChange } from "./session";
import { esc, toast } from "./ui";

let cache: Promise<Watch[]> | null = null;
onUserChange(() => (cache = null));

function watches(): Promise<Watch[]> {
  cache ??= api.watches().then((r) => r.watches, () => []);
  return cache;
}

export const watchButtonHtml = (label: string) =>
  `<button class="btn watch-btn" data-watch aria-pressed="false" title="Get an email when a new game build changes these talents">
    <span class="bell" aria-hidden="true">🔔</span><span class="watch-label">${esc(label)}</span></button>`;

/** Wire a button rendered by watchButtonHtml. */
export async function wireWatchButton(btn: HTMLButtonElement | null, kind: Watch["kind"], target: string, label: string) {
  if (!btn) return;
  const user = await currentUser();
  const set = (on: boolean) => {
    btn.setAttribute("aria-pressed", String(on));
    btn.querySelector(".watch-label")!.textContent = on ? "Watching" : label;
  };
  if (user) set((await watches()).some((w) => w.kind === kind && w.target === target));
  btn.addEventListener("click", async () => {
    const me = await currentUser();
    if (!me) {
      toast("Sign in to get change alerts");
      return navigate(loginUrl());
    }
    const on = btn.getAttribute("aria-pressed") === "true";
    btn.disabled = true;
    try {
      if (on) await api.unwatch(kind, target);
      else await api.watch(kind, target);
      cache = null;
      set(!on);
      toast(on ? "Stopped watching" : "We'll email you when these talents change");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      btn.disabled = false;
    }
  });
}
