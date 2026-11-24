// Typed client for the /api endpoints in server/api.ts: only the "Report a bug" form uses it.

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

export const api = {
  sendFeedback: (input: FeedbackInput) => call<{ ok: true }>("POST", "/feedback", input),
};
