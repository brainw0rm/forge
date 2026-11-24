// Approve or reject a recipe source report, from the signed link in the notification email. The link
// only opens this page; the decision is a POST, so mail scanners that follow links can't approve anything.

import { api } from "../api";
import { esc, setTitle } from "../ui";

export function renderModerate(root: HTMLElement, params: URLSearchParams) {
  setTitle("Recipe source report");
  const id = Number(params.get("id"));
  const action = params.get("a") === "reject" ? "reject" : "approve";
  const sig = params.get("sig") ?? "";
  root.innerHTML = `
    <section class="page"><div class="codex moderate">
      <h1>${action === "approve" ? "Approve" : "Reject"} report #${id}?</h1>
      <p>${action === "approve" ? "It will show on the recipe page." : "It won't be shown, and it's deleted after 90 days."}</p>
      <div class="form-actions"><a class="btn ghost" href="/" data-link>Cancel</a><button class="btn primary" id="go">${action === "approve" ? "Approve" : "Reject"}</button></div>
    </div></section>`;
  root.querySelector("#go")!.addEventListener("click", async () => {
    const card = root.querySelector(".moderate")!;
    try {
      const { report, status } = await api.moderateSource(id, action, sig);
      card.innerHTML = `<h1>Report ${esc(status)}</h1>
        <p>${esc(report.kind)}: <b>${esc(report.place)}</b>${report.zone ? ` (${esc(report.zone)})` : ""}</p>
        <p><a href="/professions/${esc(report.prof)}/${report.spell}" data-link>Open the recipe</a></p>`;
    } catch (err) {
      card.innerHTML = `<h1>That didn't work</h1><p>${esc((err as Error).message)}</p>`;
    }
  });
}
