// The Share dialog: copy the link or a ready-to-post line, open Reddit / X / Bluesky with it filled in,
// or hand it to the phone's own share sheet. Shows the preview image the link will unfurl with.

import { openModal } from "./modal";
import { copy, esc } from "./ui";

export interface ShareInfo {
  url: string;
  /** The line people post with the link, e.g. "Frost Mage 0/31/20 talent build for WoW Forever". */
  text: string;
  /** Preview image path (/og/...), if the link has one. */
  image?: string;
}

export function openShare({ url, text, image }: ShareInfo) {
  const post = `${text}\n${url}`;
  const enc = encodeURIComponent;
  const targets = [
    { name: "Reddit", href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}` },
    { name: "X", href: `https://x.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
    { name: "Bluesky", href: `https://bsky.app/intent/compose?text=${enc(post)}` },
  ];
  const native = typeof navigator.share === "function";

  const dlg = openModal(
    "Share",
    `<div class="share">
      ${
        image
          ? `<figure class="share-preview">
              <img src="${esc(image)}" width="1200" height="630" alt="Preview image for this link" />
              <figcaption>Discord, Reddit and X show this card with the link.</figcaption>
            </figure>`
          : ""
      }
      <div class="share-link">
        <input readonly value="${esc(url)}" aria-label="Link" />
        <button type="button" class="btn primary" data-copy="link">Copy link</button>
      </div>
      <div class="share-post">
        <p>${esc(text)}</p>
        <button type="button" class="btn" data-copy="post">Copy with text</button>
      </div>
      <div class="share-targets">
        ${targets.map((t) => `<a class="btn" href="${esc(t.href)}" target="_blank" rel="noopener">${t.name}</a>`).join("")}
        ${native ? `<button type="button" class="btn" data-native>More apps…</button>` : ""}
      </div>
    </div>`,
  );

  const input = dlg.querySelector<HTMLInputElement>(".share-link input")!;
  input.addEventListener("focus", () => input.select());
  dlg.querySelector('[data-copy="link"]')!.addEventListener("click", () => copy(url, "Link copied"));
  dlg.querySelector('[data-copy="post"]')!.addEventListener("click", () => copy(post, "Copied, ready to paste"));
  dlg.querySelector("[data-native]")?.addEventListener("click", () => navigator.share({ title: text, text, url }).catch(() => {}));
  dlg.querySelector<HTMLElement>('[data-copy="link"]')!.focus();
}
