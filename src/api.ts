// Typed client for the /api endpoints in server/api.ts.

/** A news headline linking to the publisher's article (we never store the article itself). */
export interface Headline {
  url: string;
  source: string;
  title: string;
  published: number;
  hidden?: true;
}

export interface NewsSourceInfo {
  id: string;
  name: string;
  site: string;
  lang: "en" | "de";
}

export interface NewsPage {
  items: Headline[];
  hasMore: boolean;
  sources: NewsSourceInfo[];
  updatedAt: number | null;
}

export interface FeedbackReport {
  id: number;
  kind: "bug" | "data" | "idea";
  message: string;
  page: string;
  context: Record<string, string>;
  email: string | null;
  username: string | null;
  createdAt: number;
}

export interface User {
  id: number;
  username: string;
  email: string;
  createdAt: number;
  emailVerified: boolean;
  role: "user" | "admin";
}

export interface SavedBuild {
  id: string;
  class: string;
  code: string;
  split: string;
  points: number;
  title: string;
  description: string;
  isPublic: boolean;
  /** Moderators only: unresolved reports. */
  openReports?: number;
  /** Hidden by moderators (only its owner and admins can see it). */
  hidden: boolean;
  gameBuild: number;
  createdAt: number;
  updatedAt: number;
  author: string;
  rating: { avg: number; count: number };
  myRating: number | null;
  /** The viewer has an open report on this build. */
  reported: boolean;
  mine: boolean;
}

export interface Report {
  reason: string;
  details: string;
  reporter: string;
  createdAt: number;
}

export interface TalentStats {
  class: string;
  builds: number;
  picks: Record<string, number>;
  brackets: { level: number; builds: number; picks: Record<string, number> }[];
}

export interface Watch {
  kind: "class" | "build";
  target: string;
  createdAt: number;
  title: string | null;
  class: string | null;
}

export interface BuildInput {
  class: string;
  code: string;
  split: string;
  title: string;
  description: string;
  isPublic: boolean;
  gameBuild: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const api = {
  me: () => call<{ user: User | null }>("GET", "/me"),
  signup: (username: string, email: string, password: string) =>
    call<{ user: User; mailSent: boolean }>("POST", "/auth/signup", { username, email, password }),
  verifyEmail: (token: string) => call<{ user: User }>("POST", "/auth/verify", { token }),
  resendVerification: () => call<{ ok: true }>("POST", "/auth/resend-verification", {}),
  forgotPassword: (email: string) => call<{ ok: true }>("POST", "/auth/forgot", { email }),
  resetPassword: (token: string, password: string) =>
    call<{ user: User }>("POST", "/auth/reset", { token, password }),
  changePassword: (current: string, password: string) =>
    call<{ ok: true }>("PUT", "/me/password", { current, password }),
  login: (login: string, password: string) => call<{ user: User }>("POST", "/auth/login", { login, password }),
  logout: () => call<{ ok: true }>("POST", "/auth/logout", {}),
  deleteAccount: (password: string) => call<{ ok: true }>("DELETE", "/me", { password }),

  myBuilds: () => call<{ builds: SavedBuild[] }>("GET", "/me/builds"),
  builds: (params: { class?: string; sort?: "top" | "new"; q?: string; author?: string; page?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
    return call<{ builds: SavedBuild[]; page: number; hasMore: boolean }>("GET", `/builds?${qs}`);
  },
  build: (id: string) => call<{ build: SavedBuild }>("GET", `/builds/${encodeURIComponent(id)}`),
  createBuild: (input: BuildInput) => call<{ build: SavedBuild }>("POST", "/builds", input),
  updateBuild: (id: string, input: BuildInput) =>
    call<{ build: SavedBuild }>("PUT", `/builds/${encodeURIComponent(id)}`, input),
  deleteBuild: (id: string) => call<{ ok: true }>("DELETE", `/builds/${encodeURIComponent(id)}`),
  rate: (id: string, stars: number) =>
    call<{ build: SavedBuild }>("PUT", `/builds/${encodeURIComponent(id)}/rating`, { stars }),
  unrate: (id: string) => call<{ build: SavedBuild }>("DELETE", `/builds/${encodeURIComponent(id)}/rating`),
  report: (id: string, reason: string, details: string) =>
    call<{ ok: true }>("POST", `/builds/${encodeURIComponent(id)}/report`, { reason, details }),

  talentStats: (cls: string) => call<TalentStats>("GET", `/stats/talents?class=${encodeURIComponent(cls)}`),

  watches: () => call<{ watches: Watch[] }>("GET", "/me/watches"),
  watch: (kind: Watch["kind"], target: string) => call<{ ok: true }>("PUT", "/watches", { kind, target }),
  unwatch: (kind: Watch["kind"], target: string) => call<{ ok: true }>("DELETE", "/watches", { kind, target }),
  unsubscribe: (u: number, t: string) => call<{ ok: true }>("POST", "/unsubscribe", { u, t }),

  news: (params: { lang?: string; source?: string; before?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
    return call<NewsPage>("GET", `/news?${qs}`);
  },
  adminNews: () => call<{ items: Headline[] }>("GET", "/admin/news"),
  setNewsHidden: (url: string, hidden: boolean) => call<{ ok: true }>("POST", `/admin/news/${hidden ? "hide" : "unhide"}`, { url }),

  sendFeedback: (input: { kind: string; message: string; email: string; page: string; context: Record<string, string>; website: string }) =>
    call<{ ok: true }>("POST", "/feedback", input),
  openFeedback: () => call<{ reports: FeedbackReport[] }>("GET", "/admin/feedback"),
  resolveFeedback: (id: number) => call<{ ok: true }>("POST", `/admin/feedback/${id}/resolve`, {}),

  moderationQueue: () => call<{ queue: { build: SavedBuild; reports: Report[] }[] }>("GET", "/admin/reports"),
  moderate: (id: string, action: "dismiss" | "hide" | "unhide" | "delete") =>
    call<{ ok: true }>("POST", `/admin/builds/${encodeURIComponent(id)}/moderate`, { action }),
};
