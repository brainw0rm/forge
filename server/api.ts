// JSON API: the "Report a bug" form and recipe source reports. Mounted at /api by functions/api/[[path]].ts.

import { checkOrigin, fail, HttpError, json, type Env, type Route } from "./http";
import { feedbackRoutes } from "./routes/feedback";
import { sourceRoutes } from "./routes/sources";

export type { Env } from "./http";

const devRoutes: Route[] = [
  [
    "GET",
    /^\/dev\/outbox$/,
    async (req, env) => {
      // Local development only: read mail that would have been sent.
      if (env.DEV_MAIL_OUTBOX !== "1") fail(404, "Not found.");
      const to = new URL(req.url).searchParams.get("to") ?? "";
      const { results } = await env.DB.prepare(
        "SELECT to_addr AS 'to', subject, text, created_at AS createdAt FROM dev_outbox WHERE ?1 = '' OR to_addr = ?1 ORDER BY id DESC LIMIT 20",
      )
        .bind(to)
        .all();
      return json({ messages: results });
    },
  ],
];

const routes: Route[] = [...feedbackRoutes, ...sourceRoutes, ...devRoutes];

export async function handle(req: Request, env: Env): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/^\/api/, "") || "/";
  try {
    checkOrigin(req);
    let pathMatched = false;
    for (const [method, pattern, handler] of routes) {
      const m = pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (method === req.method) return await handler(req, env, m.slice(1));
    }
    return pathMatched ? json({ error: "Method not allowed." }, 405) : json({ error: "Not found." }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong on our side." }, 500);
  }
}
