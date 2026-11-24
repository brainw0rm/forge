// Typed client for the /api endpoints in server/api.ts: bug reports and recipe source reports.

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

export interface FeedbackInput {
  kind: string;
  message: string;
  email: string;
  page: string;
  website: string;
  context: Record<string, string>;
}

export type SourceKind = "drop" | "vendor" | "quest" | "trainer" | "container" | "other";

export interface SourceInput {
  prof: string;
  spell: number;
  kind: SourceKind;
  place: string;
  zone: string;
  note: string;
  website: string;
}

/** Approved player reports for a recipe; identical ones merged with how many players reported them. */
export interface ReportedSource {
  kind: SourceKind;
  place: string;
  zone: string;
  reports: number;
  latest: number;
}

export const api = {
  sendFeedback: (input: FeedbackInput) => call<{ ok: true }>("POST", "/feedback", input),
  sendSource: (input: SourceInput) => call<{ ok: true }>("POST", "/sources", input),
  sources: (prof: string, spell: number) => call<{ sources: ReportedSource[] }>("GET", `/sources/${prof}/${spell}`),
  moderateSource: (id: number, action: string, sig: string) =>
    call<{ ok: true; status: string; report: { prof: string; spell: number; kind: SourceKind; place: string; zone: string } }>("POST", "/moderate/sources", { id, action, sig }),
};
