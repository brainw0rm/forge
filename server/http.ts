// Request/response helpers shared by the route modules.

export interface Env {
  DB: D1Database;
  /** Static site files (Cloudflare Pages); used for class data, fonts and index.html. */
  ASSETS?: Fetcher;
  /** Resend API key. Without it, mail goes to the dev outbox (if enabled) or fails. */
  RESEND_API_KEY?: string;
  /** Sender, e.g. "Forever Forge <noreply@forever-forge.com>". */
  MAIL_FROM?: string;
  /** Public site URL used in emailed links; defaults to the request's origin. */
  APP_URL?: string;
  /** Shared secret for the internal alert job and for signing unsubscribe links. */
  NOTIFY_SECRET?: string;
  /** Optional inbox that receives a copy of every "Report a bug" submission. */
  FEEDBACK_EMAIL?: string;
  /** "1" in local development: store mail in dev_outbox and expose /api/dev/outbox. */
  DEV_MAIL_OUTBOX?: string;
}

export type Handler = (req: Request, env: Env, params: string[]) => Promise<Response>;
export type Route = [method: string, pattern: RegExp, handler: Handler];

const MAX_BODY = 16 * 1024;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export async function body<T>(req: Request): Promise<T> {
  if (!req.headers.get("Content-Type")?.startsWith("application/json")) fail(415, "Expected JSON.");
  const text = await req.text();
  if (text.length > MAX_BODY) fail(413, "Request too large.");
  try {
    return JSON.parse(text) as T;
  } catch {
    return fail(400, "Invalid JSON.");
  }
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");

export function check(problem: string | null) {
  if (problem) fail(400, problem);
}

/** Blocks cross-site form posts: state-changing requests must come from our own origin. */
export function checkOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("Origin");
  if (!origin || origin !== new URL(req.url).origin) fail(403, "Cross-origin request refused.");
}

/** Sliding-window limit per client IP for sensitive endpoints (sign-in, sign-up, email sends). */
export async function rateLimit(env: Env, req: Request) {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  const now = Date.now();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE ip = ? AND at > ?")
    .bind(ip, now - ATTEMPT_WINDOW_MS)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= MAX_ATTEMPTS) fail(429, "Too many attempts. Try again in a few minutes.");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_attempts (ip, at) VALUES (?, ?)").bind(ip, now),
    env.DB.prepare("DELETE FROM auth_attempts WHERE at < ?").bind(now - 86_400_000),
  ]);
}

export function appUrl(env: Env, req: Request) {
  return (env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");
}
