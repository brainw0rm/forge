// Accessible modal dialog built on <dialog>.

export function openModal(title: string, bodyHtml: string): HTMLDialogElement {
  const dlg = document.createElement("dialog");
  dlg.className = "modal";
  dlg.innerHTML = `
    <div class="modal-head">
      <h2>${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>`;
  document.body.append(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || (e.target as HTMLElement).closest("[data-close]")) dlg.close();
  });
  dlg.showModal();
  // showModal focuses the close button first; start on the first field instead.
  dlg.querySelector<HTMLElement>(".modal-body [autofocus], .modal-body input, .modal-body textarea, .modal-body button")?.focus();
  return dlg;
}

/** Show an error under a form, or clear it. */
export function formError(form: HTMLElement, message: string | null) {
  let el = form.querySelector<HTMLElement>(".form-error");
  if (!el) {
    el = document.createElement("p");
    el.className = "form-error";
    el.setAttribute("role", "alert");
    form.querySelector(".form-actions")?.before(el);
  }
  el.textContent = message ?? "";
  el.hidden = !message;
}

export function busy(button: HTMLButtonElement | null, on: boolean, label?: string) {
  if (!button) return;
  if (on) {
    button.dataset.label = button.textContent ?? "";
    button.textContent = label ?? "Working…";
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = on;
}
