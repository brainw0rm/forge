import { api } from "../api";
import { getMeta } from "../data";
import { busy, formError, openModal } from "../modal";
import { checkPassword, LIMITS } from "../../shared/validate";
import { navigate } from "../router";
import { currentUser, loginUrl, setUser } from "../session";
import { esc, setTitle, toast } from "../ui";
import { buildCard, confirmDelete } from "./builds";

export async function renderAccount(root: HTMLElement) {
  // Re-read the session so a confirmation done in another tab shows up here.
  const user = (await api.me().catch(() => ({ user: null }))).user ?? (await currentUser());
  if (!user) return navigate(loginUrl("/account"), { replace: true });
  setUser(user);
  setTitle("My account");
  const [meta, { builds }, { watches }] = await Promise.all([
    getMeta(),
    api.myBuilds(),
    api.watches().catch(() => ({ watches: [] })),
  ]);
  const names = new Map(meta.classes.map((c) => [c.slug, c.name]));
  const since = new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long" });
  const ratings = builds.reduce((n, b) => n + b.rating.count, 0);

  root.innerHTML = `
    <section class="page">
      <header class="page-head">
        <div>
          <h1>${esc(user.username)}</h1>
          <p class="lede">Member since ${esc(since)} · ${builds.length} build${builds.length === 1 ? "" : "s"} · ${ratings} rating${ratings === 1 ? "" : "s"} received</p>
        </div>
        <a class="btn primary" href="/talents/warrior" data-link>New build</a>
      </header>

      ${
        user.emailVerified
          ? ""
          : `<div class="banner warn verify-banner">
              <div><strong>Confirm your email address</strong>
                <p class="muted">We sent a link to <b>${esc(user.email)}</b>. Until you confirm, you can save private builds but not publish or rate.</p></div>
              <button class="btn" id="resend">Resend email</button>
            </div>`
      }
      <h2 class="section-title">My builds</h2>
      ${
        builds.length
          ? `<div class="build-grid">${builds
              .map(
                (b) => `<div class="build-card-wrap">${buildCard(b, names.get(b.class) ?? b.class, { showAuthor: false })}
                  <div class="card-actions">
                    <a class="btn small" href="/talents/${b.class}/${b.code}?edit=${b.id}" data-link>Edit</a>
                    <button class="btn small ghost danger" data-delete="${esc(b.id)}">Delete</button>
                  </div></div>`,
              )
              .join("")}</div>`
          : `<div class="empty"><h3>No saved builds yet</h3>
              <p>Plan a build in the calculator and press <b>Save build</b>. It will show up here.</p>
              <a class="btn primary" href="/talents/warrior" data-link>Open the calculator</a></div>`
      }

      <h2 class="section-title">Change alerts</h2>
      <p class="muted small">When a new game build changes talents in a class or build you watch, we send you an email. Use the
        <b>Watch</b> button in the calculator or on a build page.</p>
      ${
        watches.length
          ? `<ul class="watch-list">${watches
              .map(
                (w) => `<li><span class="tag">${w.kind === "class" ? "Class" : "Build"}</span>
                  <a href="${w.kind === "class" ? `/talents/${w.target}` : `/builds/${w.target}`}" data-link>${esc(
                    w.kind === "class" ? names.get(w.target) ?? w.target : w.title ?? "Deleted build",
                  )}</a>
                  <button class="btn small ghost" data-unwatch="${w.kind}:${esc(w.target)}">Stop</button></li>`,
              )
              .join("")}</ul>`
          : `<p class="muted">You're not watching anything yet.</p>`
      }

      <h2 class="section-title">Account</h2>
      <div class="settings">
        <div class="setting">
          <div><h3>Email ${user.emailVerified ? `<span class="badge ok">Confirmed</span>` : `<span class="badge warn">Not confirmed</span>`}</h3>
            <p class="muted">${esc(user.email)} · used to sign in and reset your password, never shown publicly.</p></div>
        </div>
        <div class="setting">
          <div><h3>Password</h3><p class="muted">Changing it signs you out on your other devices.</p></div>
          <button class="btn" id="change-password">Change password</button>
        </div>
        <div class="setting">
          <div><h3>Delete account</h3><p class="muted">Permanently removes your account, your builds and your ratings.</p></div>
          <button class="btn danger" id="delete-account">Delete account</button>
        </div>
      </div>
    </section>`;

  root.querySelector("#resend")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    busy(btn, true, "Sending…");
    try {
      await api.resendVerification();
      toast(`Sent! Check ${user.email}`);
      busy(btn, false);
    } catch (err) {
      busy(btn, false);
      toast((err as Error).message);
    }
  });
  root.querySelector("#change-password")!.addEventListener("click", () => {
    const dlg = openModal(
      "Change password",
      `<form class="form" novalidate>
        <label>Current password
          <input type="password" name="current" autocomplete="current-password" required autofocus />
        </label>
        <label>New password
          <input type="password" name="password" autocomplete="new-password" required minlength="${LIMITS.password.min}" />
          <span class="hint">At least ${LIMITS.password.min} characters.</span>
        </label>
        <div class="form-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn primary">Change password</button>
        </div>
      </form>`,
    );
    const form = dlg.querySelector("form")!;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const data = new FormData(form);
      const next = String(data.get("password") ?? "");
      const problem = checkPassword(next);
      if (problem) return formError(form, problem);
      const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
      busy(btn, true, "Saving…");
      try {
        await api.changePassword(String(data.get("current") ?? ""), next);
        dlg.close();
        toast("Password changed");
      } catch (err) {
        busy(btn, false);
        formError(form, (err as Error).message);
      }
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-unwatch]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const [kind, target] = btn.dataset.unwatch!.split(":");
      await api.unwatch(kind as "class" | "build", target).catch(() => undefined);
      btn.closest("li")?.remove();
      toast("Stopped watching");
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const b = builds.find((x) => x.id === btn.dataset.delete)!;
      confirmDelete(b, () => renderAccount(root));
    }),
  );
  root.querySelector("#delete-account")!.addEventListener("click", () => {
    const dlg = openModal(
      "Delete your account?",
      `<form class="form" novalidate>
        <p>This permanently deletes <b>${esc(user.username)}</b>, all ${builds.length} of your builds and every rating you've given. It can't be undone.</p>
        <label>Confirm with your password
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <div class="form-actions">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn danger">Delete everything</button>
        </div>
      </form>`,
    );
    const form = dlg.querySelector("form")!;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
      busy(btn, true, "Deleting…");
      try {
        await api.deleteAccount(String(new FormData(form).get("password") ?? ""));
        dlg.close();
        setUser(null);
        toast("Your account was deleted");
        navigate("/");
      } catch (err) {
        busy(btn, false);
        formError(form, (err as Error).message);
      }
    });
  });
}
