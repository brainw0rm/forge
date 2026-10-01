// Seeds the LOCAL dev database with demo users, builds and ratings through the API.
// Usage: npm run dev   (in another terminal)   then   node scripts/seed-local.mjs
// These accounts exist only in .wrangler/ on your machine.

const BASE = process.env.BASE_URL ?? "http://localhost:5173";

export const DEMO_USERS = [
  { username: "Demo", email: "demo@example.test", password: "demo-password-1" },
  { username: "Kazrak", email: "kazrak@example.test", password: "demo-password-2" },
  { username: "Seralyn", email: "seralyn@example.test", password: "demo-password-3" },
];

// Not created by the seed: used for manually testing sign-up, confirmation and deletion in the UI.
export const UI_TEST_USER = { username: "Tester", email: "tester@example.test", password: "tester-password-1" };

// Builds are generated from the live talent data (see talentCode) so codes stay valid.
const BUILDS = [
  { by: 1, class: "warrior", tree: "Fury", points: 21, title: "Fury leveling 10–30", description: "Cruelty and Unbridled Wrath first, then Blood Craze. Swap to 2H Arms at 40 if you like." },
  { by: 2, class: "warrior", tree: "Fury", points: 10, title: "Early fury opener", description: "Minimal points for the first dungeons." },
  { by: 2, class: "mage", tree: "Frost", points: 15, title: "Frost AoE farming", description: "Blizzard + Frost Nova grind spec." },
  { by: 0, class: "mage", tree: "Arcane", points: 11, title: "Arcane raid (WIP)", description: "Work in progress for Barrow Deeps." },
];

async function call(cookie, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Origin: BASE, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { res, data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie };
}

// Confirms the user's email by reading the link from the dev outbox (npm run dev enables it).
async function verify(cookie, u) {
  let mail = await (await fetch(`${BASE}/api/dev/outbox?to=${encodeURIComponent(u.email)}`)).json();
  if (!mail.messages?.some((m) => m.text.includes("/verify-email?token="))) {
    await call(cookie, "POST", "/auth/resend-verification", {});
    mail = await (await fetch(`${BASE}/api/dev/outbox?to=${encodeURIComponent(u.email)}`)).json();
  }
  const link = mail.messages?.map((m) => /\/verify-email\?token=(\S+)/.exec(m.text)).find(Boolean);
  if (!link) throw new Error(`No confirmation mail for ${u.email}. Is the dev server running with the outbox enabled?`);
  await call(cookie, "POST", "/auth/verify", { token: decodeURIComponent(link[1]) });
}

async function session(u) {
  let r = await call(null, "POST", "/auth/signup", u);
  if (r.res.status === 409) r = await call(null, "POST", "/auth/login", { login: u.username, password: u.password });
  if (!r.res.ok) throw new Error(`${u.username}: ${r.data.error}`);
  if (!r.data.user.emailVerified) await verify(r.cookie, u);
  return r.cookie;
}

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const encode = (ids) => ids.map((id) => A[(id >> 12) & 63] + A[(id >> 6) & 63] + A[id & 63]).join("");

/** Spend `points` in one tree, lowest tier first, respecting tier gates and prerequisites. */
async function talentCode(slug, treeName, points) {
  const cls = await (await fetch(`${BASE}/data/classes/${slug}.json`)).json();
  const tree = cls.trees.find((t) => t.name === treeName);
  const byId = new Map(tree.talents.map((t) => [t.id, t]));
  const ranks = new Map();
  const below = (tier) => [...ranks].reduce((n, [id, r]) => n + (byId.get(id).tier < tier ? r : 0), 0);
  const order = [];
  const talents = [...tree.talents].sort((a, b) => a.tier - b.tier || a.col - b.col);
  while (order.length < points) {
    const next = talents.find((t) => {
      if ((ranks.get(t.id) ?? 0) >= t.ranks.length) return false;
      if (below(t.tier) < (t.req ?? t.tier * 5)) return false;
      return !t.prereq || (ranks.get(t.prereq.id) ?? 0) >= t.prereq.rank;
    });
    if (!next) break;
    ranks.set(next.id, (ranks.get(next.id) ?? 0) + 1);
    order.push(next.id);
  }
  const split = cls.trees.map((t) => (t.name === treeName ? order.length : 0)).join("/");
  return { code: encode(order), split };
}

const cookies = [];
for (const u of DEMO_USERS) cookies.push(await session(u));
const gameBuild = Number((await (await fetch(`${BASE}/data/meta.json`)).json()).build.split(".").pop());
const ids = [];
for (const b of BUILDS) {
  // Re-running the seed reuses builds that already exist instead of duplicating them.
  const mine = (await call(cookies[b.by], "GET", "/me/builds")).data.builds ?? [];
  const existing = mine.find((x) => x.title === b.title);
  if (existing) {
    ids.push(existing.id);
    continue;
  }
  const { code, split } = await talentCode(b.class, b.tree, b.points);
  const r = await call(cookies[b.by], "POST", "/builds", {
    class: b.class, title: b.title, description: b.description, code, split, isPublic: true, gameBuild,
  });
  if (!r.res.ok) throw new Error(r.data.error);
  ids.push(r.data.build.id);
}
// A few ratings from people other than the author.
const ratings = [[0, 1, 5], [0, 2, 4], [1, 0, 3], [2, 0, 5], [2, 1, 4], [3, 2, 2]];
for (const [build, user, stars] of ratings) {
  if (BUILDS[build].by !== user) await call(cookies[user], "PUT", `/builds/${ids[build]}/rating`, { stars });
}
console.log(`Seeded ${DEMO_USERS.length} users and ${ids.length} builds at ${BASE}`);
console.log(`Make ${DEMO_USERS[0].username} a moderator with: npm run make-admin -- ${DEMO_USERS[0].username}`);
