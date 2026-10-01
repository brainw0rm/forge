import { api } from "../api";
import { busy, formError } from "../modal";
import { esc } from "../ui";
import { navigate } from "../router";
import { currentUser, setUser } from "../session";
import { checkEmail, checkPassword, checkUsername, LIMITS } from "../../shared/validate";
import { setTitle, toast } from "../ui";

/** Only follow same-site relative redirects. */
function nextUrl(params: URLSearchParams) {
  const next = params.get("next") ?? "/account";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

export async function renderLogin(root: HTMLElement, params: URLSearchParams) {
  if (await currentUser()) return navigate(nextUrl(params), { replace: true });
  setTitle("Sign in");
  const next = nextUrl(params);
  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-card">
        <h1>Sign in</h1>
        <p class="muted">Good to see you again.</p>
        <form class="form" novalidate>
          <label>Username or email
            <input name="login" autocomplete="username" required autofocus />
          </label>
          <label><span class="label-row">Password <a href="/forgot-password" data-link class="small">Forgot password?</a></span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <div class="form-actions">
            <button class="btn primary block" type="submit">Sign in</button>
          </div>
        </form>
        <p class="auth-switch">New here? <a href="/signup?next=${encodeURIComponent(next)}" data-link>Create an account</a></p>
      </div>
    </section>`;
  const form = root.querySelector("form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const login = String(data.get("login") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!login || !password) return formError(form, "Enter your username or email and password.");
    const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
    busy(btn, true, "Signing in…");
    try {
      const { user } = await api.login(login, password);
      setUser(user);
      toast(`Signed in as ${user.username}`);
      navigate(next, { replace: true });
    } catch (err) {
      busy(btn, false);
      formError(form, (err as Error).message);
    }
  });
}

export async function renderSignup(root: HTMLElement, params: URLSearchParams) {
  if (await currentUser()) return navigate(nextUrl(params), { replace: true });
  setTitle("Create account");
  const next = nextUrl(params);
  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-card">
        <h1>Create your account</h1>
        <p class="muted">It's free. You'll be able to save builds and rate other people's.</p>
        <form class="form" novalidate>
          <label>Username
            <input name="username" autocomplete="username" required autofocus
              minlength="${LIMITS.username.min}" maxlength="${LIMITS.username.max}" />
            <span class="hint">Shown on your public builds. Letters, numbers, - and _.</span>
          </label>
          <label>Email
            <input name="email" type="email" autocomplete="email" required maxlength="${LIMITS.email.max}" />
            <span class="hint">Only used to sign in. Never shown publicly.</span>
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="new-password" required minlength="${LIMITS.password.min}" />
            <span class="hint">At least ${LIMITS.password.min} characters.</span>
          </label>
          <p class="fine">By creating an account you agree to how we handle your data in the <a href="/privacy" data-link>privacy policy</a>.</p>
          <div class="form-actions">
            <button class="btn primary block" type="submit">Create account</button>
          </div>
        </form>
        <p class="auth-switch">Already have an account? <a href="/login?next=${encodeURIComponent(next)}" data-link>Sign in</a></p>
      </div>
    </section>`;
  const form = root.querySelector("form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const problem = checkUsername(username) ?? checkEmail(email) ?? checkPassword(password);
    if (problem) return formError(form, problem);
    const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
    busy(btn, true, "Creating account…");
    try {
      const { user, mailSent } = await api.signup(username, email, password);
      setUser(user);
      toast(mailSent ? `Welcome, ${user.username}! Check your inbox to confirm your email.` : `Welcome, ${user.username}!`);
      navigate(next, { replace: true });
    } catch (err) {
      busy(btn, false);
      formError(form, (err as Error).message);
    }
  });
}

export async function logout() {
  await api.logout().catch(() => undefined);
  setUser(null);
  toast("Signed out");
  navigate("/");
}


export function renderForgot(root: HTMLElement) {
  setTitle("Forgot password");
  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-card" id="card">
        <h1>Forgot your password?</h1>
        <p class="muted">Enter your account's email address and we'll send you a link to choose a new password.</p>
        <form class="form" novalidate>
          <label>Email
            <input name="email" type="email" autocomplete="email" required autofocus />
          </label>
          <div class="form-actions">
            <button class="btn primary block" type="submit">Send reset link</button>
          </div>
        </form>
        <p class="auth-switch"><a href="/login" data-link>Back to sign in</a></p>
      </div>
    </section>`;
  const form = root.querySelector("form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = String(new FormData(form).get("email") ?? "").trim();
    const problem = checkEmail(email);
    if (problem) return formError(form, problem);
    const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
    busy(btn, true, "Sending…");
    try {
      await api.forgotPassword(email);
      root.querySelector("#card")!.innerHTML = `
        <h1>Check your inbox</h1>
        <p class="muted">If <b>${esc(email)}</b> belongs to an account, a reset link is on its way. It's valid for 1 hour.
          Don't see it? Check your spam folder.</p>
        <p class="auth-switch"><a href="/login" data-link>Back to sign in</a></p>`;
    } catch (err) {
      busy(btn, false);
      formError(form, (err as Error).message);
    }
  });
}

export function renderReset(root: HTMLElement, params: URLSearchParams) {
  setTitle("Choose a new password");
  const token = params.get("token") ?? "";
  // Keep the token out of history and referrers once it's been read.
  history.replaceState(null, "", "/reset-password");
  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-card">
        <h1>Choose a new password</h1>
        ${
          token
            ? `<p class="muted">You'll be signed out on other devices.</p>
              <form class="form" novalidate>
                <label>New password
                  <input name="password" type="password" autocomplete="new-password" required autofocus minlength="${LIMITS.password.min}" />
                  <span class="hint">At least ${LIMITS.password.min} characters.</span>
                </label>
                <div class="form-actions"><button class="btn primary block" type="submit">Save password</button></div>
              </form>`
            : `<p class="muted">This link is missing its token. <a href="/forgot-password" data-link>Request a new reset link</a>.</p>`
        }
      </div>
    </section>`;
  const form = root.querySelector("form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = String(new FormData(form).get("password") ?? "");
    const problem = checkPassword(password);
    if (problem) return formError(form, problem);
    const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
    busy(btn, true, "Saving…");
    try {
      const { user } = await api.resetPassword(token, password);
      setUser(user);
      toast("Password changed. You're signed in.");
      navigate("/account", { replace: true });
    } catch (err) {
      busy(btn, false);
      formError(form, (err as Error).message);
    }
  });
}

export async function renderVerify(root: HTMLElement, params: URLSearchParams) {
  setTitle("Confirm email");
  const token = params.get("token") ?? "";
  history.replaceState(null, "", "/verify-email");
  root.innerHTML = `<section class="auth-page"><div class="auth-card" id="card"><h1>Confirming your email…</h1></div></section>`;
  const card = root.querySelector("#card")!;
  try {
    const { user } = await api.verifyEmail(token);
    if ((await currentUser())?.id === user.id) setUser(user);
    card.innerHTML = `
      <h1>Email confirmed</h1>
      <p class="muted">Thanks, ${esc(user.username)}. You can now publish builds and rate the community's builds.</p>
      <div class="form-actions"><a class="btn primary block" href="/builds" data-link>Browse community builds</a></div>`;
  } catch (err) {
    card.innerHTML = `
      <h1>That link didn't work</h1>
      <p class="muted">${esc((err as Error).message)}</p>
      <div class="form-actions"><a class="btn block" href="/account" data-link>Go to my account</a></div>`;
  }
}
