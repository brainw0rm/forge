// "Report a bug" dialog, opened from any [data-report-bug] element. It sends the page address,
// browser and screen size along, so problems can be reproduced; the privacy policy lists exactly this.

import { api } from "./api";
import { getMeta } from "./data";
import { busy, formError, openModal } from "./modal";
import { currentUser } from "./session";
import { esc, toast } from "./ui";

const KINDS = [
  ["bug", "Something is broken", "A button, page or feature doesn't work as it should."],
  ["data", "Wrong game data", "A talent, item or number doesn't match the game."],
  ["idea", "Idea or wish", "Something you'd like the site to do."],
] as const;

export async function openBugReport(kind: string = "bug") {
  const [user, meta] = await Promise.all([currentUser(), getMeta().catch(() => null)]);
  const page = location.pathname + location.search;
  const dlg = openModal(
    "Report a bug",
    `<form class="form" novalidate>
      <fieldset class="radio-list">
        <legend class="sr">What kind of report?</legend>
        ${KINDS.map(
          ([id, label, hint]) => `<label class="radio"><input type="radio" name="kind" value="${id}" ${id === kind ? "checked" : ""} />
            <span><b>${label}</b><small class="muted">${hint}</small></span></label>`,
        ).join("")}
      </fieldset>
      <label>What happened?
        <textarea name="message" required minlength="10" maxlength="2000" rows="5"
          placeholder="What did you do, what did you expect, and what happened instead?"></textarea>
      </label>
      <label>Email <span class="optional">(optional, only if you'd like a reply)</span>
        <input type="email" name="email" autocomplete="email" maxlength="254" value="${esc(user?.email ?? "")}" />
      </label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off" /></label>
      <p class="fine">We'll also send this page's address (<code>${esc(page)}</code>), your browser, screen size and the game build shown. Nothing else.</p>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button class="btn primary">Send report</button>
      </div>
    </form>`,
  );
  const form = dlg.querySelector("form")!;
  form.querySelector<HTMLTextAreaElement>("textarea")!.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const message = String(data.get("message") ?? "").trim();
    if (message.length < 10) return formError(form, "Please describe what happened in a sentence or two.");
    const button = form.querySelector<HTMLButtonElement>(".btn.primary");
    busy(button, true, "Sending…");
    try {
      await api.sendFeedback({
        kind: String(data.get("kind") ?? "bug"),
        message,
        email: String(data.get("email") ?? "").trim(),
        page,
        website: String(data.get("website") ?? ""),
        context: { browser: navigator.userAgent, screen: `${innerWidth}×${innerHeight}`, build: meta?.build ?? "" },
      });
      dlg.close();
      toast("Thanks! Your report was sent.");
    } catch (err) {
      busy(button, false);
      formError(form, (err as Error).message);
    }
  });
}
