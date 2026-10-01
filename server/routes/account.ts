// Sign-up, sign-in, sessions, email verification, password reset and account deletion.

import { checkEmail, checkPassword, checkUsername } from "../../shared/validate";
import {
  clearCookie,
  consumeEmailToken,
  createEmailToken,
  createSession,
  destroyAllSessions,
  destroySession,
  DUMMY_HASH,
  hashPassword,
  sessionCookie,
  userFromRequest,
  USER_COLUMNS,
  verifyPassword,
  type SessionUser,
} from "../auth";
import { appUrl, body, check, fail, json, rateLimit, str, type Env, type Route } from "../http";
import { resetMail, sendMail, verifyMail } from "../mail";

const RESEND_COOLDOWN_MS = 60_000;

export const publicUser = (u: SessionUser) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  createdAt: u.created_at,
  emailVerified: u.email_verified_at !== null,
  role: u.role,
});

export async function requireUser(env: Env, req: Request): Promise<SessionUser> {
  return (await userFromRequest(env.DB, req)) ?? fail(401, "Sign in to do that.");
}

export async function requireVerified(env: Env, req: Request, action: string): Promise<SessionUser> {
  const user = await requireUser(env, req);
  if (user.email_verified_at === null) fail(403, `Confirm your email address to ${action}.`);
  return user;
}

const mailConfigured = (env: Env) => !!env.RESEND_API_KEY || env.DEV_MAIL_OUTBOX === "1";

async function sendVerification(env: Env, req: Request, user: { id: number; username: string; email: string }) {
  const token = await createEmailToken(env.DB, user.id, user.email, "verify");
  const link = `${appUrl(env, req)}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail(env, verifyMail(user.email, user.username, link));
}

async function loadUser(env: Env, id: number) {
  return (await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`).bind(id).first<SessionUser>())!;
}

export const accountRoutes: Route[] = [
  [
    "POST",
    /^\/auth\/signup$/,
    async (req, env) => {
      await rateLimit(env, req);
      const input = await body<{ username?: unknown; email?: unknown; password?: unknown }>(req);
      const username = str(input.username).trim();
      const email = str(input.email).trim().toLowerCase();
      const password = str(input.password);
      check(checkUsername(username));
      check(checkEmail(email));
      check(checkPassword(password));
      const taken = await env.DB.prepare("SELECT 1 FROM users WHERE username = ? OR email = ?")
        .bind(username, email)
        .first();
      if (taken) fail(409, "That username or email is already registered.");
      const res = await env.DB.prepare(
        "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(username, email, await hashPassword(password), Date.now())
        .run();
      const user = await loadUser(env, Number(res.meta.last_row_id));
      // The account exists either way; a mail hiccup only means "resend" is needed.
      let mailSent = true;
      try {
        await sendVerification(env, req, user);
      } catch (err) {
        mailSent = false;
        console.error("verification mail failed", err);
      }
      const { token, maxAge } = await createSession(env.DB, user.id);
      return json({ user: publicUser(user), mailSent }, 201, { "Set-Cookie": sessionCookie(req, token, maxAge) });
    },
  ],
  [
    "POST",
    /^\/auth\/login$/,
    async (req, env) => {
      await rateLimit(env, req);
      const input = await body<{ login?: unknown; password?: unknown }>(req);
      const login = str(input.login).trim();
      const password = str(input.password);
      const row = await env.DB.prepare(
        `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE u.username = ?1 OR u.email = ?1`,
      )
        .bind(login)
        .first<SessionUser & { password_hash: string }>();
      const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) fail(401, "Wrong username/email or password.");
      const { token, maxAge } = await createSession(env.DB, row!.id);
      return json({ user: publicUser(row!) }, 200, { "Set-Cookie": sessionCookie(req, token, maxAge) });
    },
  ],
  [
    "POST",
    /^\/auth\/logout$/,
    async (req, env) => {
      await destroySession(env.DB, req);
      return json({ ok: true }, 200, { "Set-Cookie": clearCookie(req) });
    },
  ],
  [
    "GET",
    /^\/me$/,
    async (req, env) => {
      const user = await userFromRequest(env.DB, req);
      return json({ user: user ? publicUser(user) : null });
    },
  ],
  [
    "DELETE",
    /^\/me$/,
    async (req, env) => {
      const user = await requireUser(env, req);
      const input = await body<{ password?: unknown }>(req);
      const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
        .bind(user.id)
        .first<{ password_hash: string }>();
      if (!row || !(await verifyPassword(str(input.password), row.password_hash))) fail(401, "Wrong password.");
      // Sessions, builds, ratings, reports and tokens go with the user via ON DELETE CASCADE;
      // other people's change alerts for this user's builds reference them by id, so remove those first.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM watches WHERE kind = 'build' AND target IN (SELECT id FROM builds WHERE user_id = ?)").bind(user.id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
      ]);
      return json({ ok: true }, 200, { "Set-Cookie": clearCookie(req) });
    },
  ],
  [
    "PUT",
    /^\/me\/password$/,
    async (req, env) => {
      const user = await requireUser(env, req);
      await rateLimit(env, req);
      const input = await body<{ current?: unknown; password?: unknown }>(req);
      const next = str(input.password);
      check(checkPassword(next));
      const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
        .bind(user.id)
        .first<{ password_hash: string }>();
      if (!row || !(await verifyPassword(str(input.current), row.password_hash))) fail(401, "Your current password is wrong.");
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(next), user.id).run();
      // Other devices must sign in again with the new password.
      await destroyAllSessions(env.DB, user.id, req);
      return json({ ok: true });
    },
  ],
  [
    "POST",
    /^\/auth\/verify$/,
    async (req, env) => {
      const userId = await consumeEmailToken(env.DB, str((await body<{ token?: unknown }>(req)).token), "verify");
      if (!userId) fail(400, "This confirmation link is invalid or has expired. Request a new one from your account page.");
      await env.DB.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?")
        .bind(Date.now(), userId)
        .run();
      return json({ user: publicUser(await loadUser(env, userId!)) });
    },
  ],
  [
    "POST",
    /^\/auth\/resend-verification$/,
    async (req, env) => {
      const user = await requireUser(env, req);
      if (user.email_verified_at !== null) fail(400, "Your email is already confirmed.");
      if (!mailConfigured(env)) fail(503, "Email isn't available right now. Try again later.");
      const last = await env.DB.prepare("SELECT MAX(created_at) AS at FROM email_tokens WHERE user_id = ? AND purpose = 'verify'")
        .bind(user.id)
        .first<{ at: number | null }>();
      if (last?.at && Date.now() - last.at < RESEND_COOLDOWN_MS) fail(429, "We just sent one. Check your inbox (and spam folder).");
      await rateLimit(env, req);
      await sendVerification(env, req, user);
      return json({ ok: true });
    },
  ],
  [
    "POST",
    /^\/auth\/forgot$/,
    async (req, env) => {
      await rateLimit(env, req);
      if (!mailConfigured(env)) fail(503, "Email isn't available right now. Try again later.");
      const email = str((await body<{ email?: unknown }>(req)).email).trim().toLowerCase();
      check(checkEmail(email));
      const user = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.email = ?`)
        .bind(email)
        .first<SessionUser>();
      if (user) {
        const token = await createEmailToken(env.DB, user.id, user.email, "reset");
        const link = `${appUrl(env, req)}/reset-password?token=${encodeURIComponent(token)}`;
        await sendMail(env, resetMail(user.email, user.username, link));
      }
      // Same answer whether or not the address has an account, so this can't be used to probe emails.
      return json({ ok: true });
    },
  ],
  [
    "POST",
    /^\/auth\/reset$/,
    async (req, env) => {
      await rateLimit(env, req);
      const input = await body<{ token?: unknown; password?: unknown }>(req);
      const password = str(input.password);
      check(checkPassword(password));
      const userId = await consumeEmailToken(env.DB, str(input.token), "reset");
      if (!userId) fail(400, "This reset link is invalid or has expired. Request a new one.");
      const now = Date.now();
      // Receiving the email proves the address, so a reset also confirms it.
      await env.DB.prepare(
        "UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?",
      )
        .bind(await hashPassword(password), now, userId)
        .run();
      await destroyAllSessions(env.DB, userId!);
      const { token, maxAge } = await createSession(env.DB, userId!);
      return json({ user: publicUser(await loadUser(env, userId!)) }, 200, {
        "Set-Cookie": sessionCookie(req, token, maxAge),
      });
    },
  ],
];
