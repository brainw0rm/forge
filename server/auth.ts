// Password hashing and cookie sessions, using only Web Crypto (runs on Workers).

const ITERATIONS = 100_000; // Workers' PBKDF2 ceiling
const SESSION_DAYS = 30;
export const SESSION_COOKIE = "ff_session";

const enc = new TextEncoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** "pbkdf2$<iterations>$<salt>$<hash>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, unb64(salt), Number(iter));
  return timingSafeEqual(actual, unb64(hash));
}

// Checked against when a login names an unknown user, so the response time
// doesn't reveal which usernames exist.
export const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256(text: string): Promise<string> {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export function randomId(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Short, URL-friendly id for builds. */
export function shortId(length = 10): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createSession(db: D1Database, userId: number): Promise<{ token: string; maxAge: number }> {
  const token = randomId();
  const maxAge = SESSION_DAYS * 86400;
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + maxAge * 1000)
    .run();
  return { token, maxAge };
}

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  created_at: number;
  email_verified_at: number | null;
  role: "user" | "admin";
}

export const USER_COLUMNS = "u.id, u.username, u.email, u.created_at, u.email_verified_at, u.role";

export async function userFromRequest(db: D1Database, req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256(token), Date.now())
    .first<SessionUser>();
  return row ?? null;
}

/** Sign out everywhere, optionally keeping the session making this request. */
export async function destroyAllSessions(db: D1Database, userId: number, keep?: Request) {
  const token = keep ? readCookie(keep, SESSION_COOKIE) : null;
  if (token) {
    await db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(userId, await sha256(token)).run();
  } else {
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  }
}

// ---------------------------------------------------------------- emailed one-time tokens

export type TokenPurpose = "verify" | "reset";
export const TOKEN_TTL: Record<TokenPurpose, number> = { verify: 48 * 3600_000, reset: 3600_000 };

/** Create a one-time token, replacing any unused ones for the same purpose. */
export async function createEmailToken(db: D1Database, userId: number, email: string, purpose: TokenPurpose) {
  const token = randomId();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL").bind(userId, purpose),
    db
      .prepare(
        "INSERT INTO email_tokens (token_hash, user_id, purpose, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(await sha256(token), userId, purpose, email, now, now + TOKEN_TTL[purpose]),
  ]);
  return token;
}

/** Mark a token used and return its owner, or null if it's unknown, used, expired or for an old email. */
export async function consumeEmailToken(db: D1Database, token: string, purpose: TokenPurpose) {
  const hash = await sha256(token);
  const row = await db
    .prepare(
      `SELECT t.user_id, t.email, u.email AS current_email FROM email_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > ?`,
    )
    .bind(hash, purpose, Date.now())
    .first<{ user_id: number; email: string; current_email: string }>();
  if (!row || row.email.toLowerCase() !== row.current_email.toLowerCase()) return null;
  // Guard against two requests racing to use the same token.
  const res = await db.prepare("UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
    .bind(Date.now(), hash)
    .run();
  return res.meta.changes === 1 ? row.user_id : null;
}

export async function destroySession(db: D1Database, req: Request) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function sessionCookie(req: Request, token: string, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(req: Request): string {
  return sessionCookie(req, "", 0);
}
