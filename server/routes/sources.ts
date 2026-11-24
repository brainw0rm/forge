// "Where did you find it?": players report where they got a recipe in WoW Forever. Reports wait until
// the operator approves them from the notification email (a link signed with REPORT_SECRET opens the
// site's /moderate page, which confirms with a POST), then show on the recipe page.

import { appUrl, body, fail, json, rateLimit, str, type Route } from "../http";
import { sendMail } from "../mail";

export const SOURCE_KINDS = ["drop", "vendor", "quest", "trainer", "container", "other"] as const;
type Kind = (typeof SOURCE_KINDS)[number];
const KIND_LABEL: Record<Kind, string> = {
  drop: "Dropped by", vendor: "Sold by", quest: "Quest reward", trainer: "Trainer", container: "Found in", other: "Other",
};
const LIMIT = { place: [2, 80], zone: [0, 60], note: [0, 300] } as const;

const enc = new TextEncoder();

async function sign(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const clean = (v: unknown, [min, max]: readonly [number, number], what: string) => {
  const s = str(v).replace(/\s+/g, " ").trim();
  if (s.length < min) fail(400, `Please fill in ${what}.`);
  if (s.length > max) fail(400, `Please keep ${what} under ${max} characters.`);
  return s;
};

export const sourceRoutes: Route[] = [
  [
    "POST",
    /^\/sources$/,
    async (req, env) => {
      const input = await body<Record<string, unknown>>(req);
      // Honeypot: a field people never see. Bots that fill it get a normal-looking answer and nothing is stored.
      if (str(input.website)) return json({ ok: true });
      await rateLimit(env, req);
      const prof = str(input.prof);
      const spell = Number(input.spell);
      if (!/^[a-z-]{2,30}$/.test(prof) || !Number.isInteger(spell) || spell <= 0) fail(400, "Unknown recipe.");
      const kind = str(input.kind) as Kind;
      if (!SOURCE_KINDS.includes(kind)) fail(400, "Pick where it came from.");
      const place = clean(input.place, LIMIT.place, "who or where");
      const zone = clean(input.zone, LIMIT.zone, "the zone");
      const note = clean(input.note, LIMIT.note, "the note");
      const now = Date.now();
      const row = await env.DB.prepare(
        "INSERT INTO source_reports (prof, spell, kind, place, zone, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
      )
        .bind(prof, spell, kind, place, zone, note, now)
        .first<{ id: number }>();
      // Reports nobody approved go after 90 days; approved ones stay, since they're shown on the site.
      await env.DB.prepare("DELETE FROM source_reports WHERE status != 'approved' AND created_at < ?").bind(now - 90 * 86_400_000).run();

      if (env.FEEDBACK_EMAIL && row) {
        const site = appUrl(env, req);
        const link = async (action: "approve" | "reject") =>
          env.REPORT_SECRET ? `${site}/moderate?id=${row.id}&a=${action}&sig=${await sign(env.REPORT_SECRET, `${row.id}:${action}`)}` : "";
        const [approve, reject] = await Promise.all([link("approve"), link("reject")]);
        const text = [
          `Recipe source report on ${site}/professions/${prof}/${spell}`,
          "",
          `${KIND_LABEL[kind]}: ${place}${zone ? ` (${zone})` : ""}`,
          ...(note ? [`Note: ${note}`] : []),
          "",
          approve ? `Approve: ${approve}\nReject: ${reject}` : "Set REPORT_SECRET on the Pages project to get approve/reject links.",
        ].join("\n");
        try {
          await sendMail(env, {
            to: env.FEEDBACK_EMAIL,
            subject: `[Forever Forge] Recipe source: ${KIND_LABEL[kind]} ${place.slice(0, 50)}`,
            text,
            html: `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${text.replace(/[&<>]/g, (ch) => `&#${ch.charCodeAt(0)};`)}</pre>`,
          });
        } catch (err) {
          console.error("source report mail failed", err); // the report is stored either way
        }
      }
      return json({ ok: true }, 201);
    },
  ],
  [
    "GET",
    /^\/sources\/([a-z-]{2,30})\/(\d{1,9})$/,
    async (_req, env, [prof, spell]) => {
      // Reports saying the same thing are shown once, with how many players reported it.
      const { results } = await env.DB.prepare(
        `SELECT kind, MIN(place) AS place, MIN(zone) AS zone, COUNT(*) AS reports, MAX(created_at) AS latest
         FROM source_reports WHERE prof = ? AND spell = ? AND status = 'approved'
         GROUP BY kind, lower(place), lower(zone) ORDER BY reports DESC, latest DESC LIMIT 20`,
      )
        .bind(prof, Number(spell))
        .all();
      return json({ sources: results }, 200, { "Cache-Control": "public, max-age=300" });
    },
  ],
  [
    "POST",
    /^\/moderate\/sources$/,
    async (req, env) => {
      const input = await body<Record<string, unknown>>(req);
      const id = Number(input.id);
      const action = str(input.action);
      if (!env.REPORT_SECRET || !Number.isInteger(id) || !["approve", "reject"].includes(action)) fail(400, "Invalid link.");
      if (!same(await sign(env.REPORT_SECRET!, `${id}:${action}`), str(input.sig))) fail(403, "This link isn't valid.");
      const row = await env.DB.prepare("SELECT prof, spell, kind, place, zone FROM source_reports WHERE id = ?")
        .bind(id)
        .first<{ prof: string; spell: number; kind: string; place: string; zone: string }>();
      if (!row) fail(404, "That report no longer exists.");
      await env.DB.prepare("UPDATE source_reports SET status = ?, decided_at = ? WHERE id = ?")
        .bind(action === "approve" ? "approved" : "rejected", Date.now(), id)
        .run();
      return json({ ok: true, report: row, status: action === "approve" ? "approved" : "rejected" });
    },
  ],
];

export { sign as signReport };
