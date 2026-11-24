// "Report a bug": anyone can send a bug report, data correction or idea. Reports land in the
// database and, when FEEDBACK_EMAIL is set, are emailed to the operator.

import { checkEmail } from "../../shared/validate";
import { body, check, fail, json, rateLimit, str, type Route } from "../http";
import { sendMail } from "../mail";

export const FEEDBACK_KINDS = ["bug", "data", "idea"] as const;
const KIND_LABEL: Record<(typeof FEEDBACK_KINDS)[number], string> = { bug: "Bug", data: "Wrong game data", idea: "Idea" };
const MESSAGE = { min: 10, max: 2000 };

/** Only the fields we document in the privacy policy, each length-capped. */
function readContext(raw: unknown): string {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return JSON.stringify({
    browser: str(c.browser).slice(0, 300),
    screen: str(c.screen).slice(0, 20),
    build: str(c.build).slice(0, 30),
  });
}

export const feedbackRoutes: Route[] = [
  [
    "POST",
    /^\/feedback$/,
    async (req, env) => {
      const input = await body<Record<string, unknown>>(req);
      // Honeypot: a field people never see. Bots that fill it get a normal-looking answer and nothing is stored.
      if (str(input.website)) return json({ ok: true });
      await rateLimit(env, req);
      const kind = str(input.kind) as (typeof FEEDBACK_KINDS)[number];
      if (!FEEDBACK_KINDS.includes(kind)) fail(400, "Pick what kind of report this is.");
      const message = str(input.message).trim();
      if (message.length < MESSAGE.min) fail(400, "Please describe what happened in a sentence or two.");
      if (message.length > MESSAGE.max) fail(400, `Please keep it under ${MESSAGE.max} characters.`);
      const page = str(input.page).slice(0, 300);
      if (!page.startsWith("/")) fail(400, "Invalid page.");
      const email = str(input.email).trim();
      if (email) check(checkEmail(email));
      const context = readContext(input.context);
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO feedback (kind, message, page, context, email, user_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
        ).bind(kind, message, page, context, email || null, now),
        // Retention promised in the privacy policy: resolved reports go after 30 days, every report after 12 months.
        env.DB.prepare("DELETE FROM feedback WHERE created_at < ? OR (resolved_at IS NOT NULL AND resolved_at < ?)").bind(
          now - 365 * 86_400_000,
          now - 30 * 86_400_000,
        ),
      ]);

      if (env.FEEDBACK_EMAIL) {
        const from = email || "anonymous";
        const text = [`${KIND_LABEL[kind]} report on ${page}`, `From: ${from}`, `Context: ${context}`, "", message].join("\n");
        try {
          await sendMail(env, {
            to: env.FEEDBACK_EMAIL,
            subject: `[Forever Forge] ${KIND_LABEL[kind]}: ${message.slice(0, 60).replace(/\s+/g, " ")}`,
            text,
            html: `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${text.replace(/[&<>]/g, (ch) => `&#${ch.charCodeAt(0)};`)}</pre>`,
          });
        } catch (err) {
          console.error("feedback mail failed", err); // the report is stored either way
        }
      }
      return json({ ok: true }, 201);
    },
  ],
];
