import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Build, decode, encode, indexClass, MAX_POINTS } from "./build";
import type { ClassData } from "./data";

const warrior: ClassData = JSON.parse(
  readFileSync(new URL("../public/data/classes/warrior.json", import.meta.url), "utf8"),
);
const idx = indexClass(warrior);
const tree = (name: string) => warrior.trees.findIndex((t) => t.name === name);
const talent = (treeName: string, name: string) =>
  warrior.trees[tree(treeName)].talents.find((t) => t.name === name)!;
const fresh = () => new Build(idx, warrior.trees.length);

function fill(b: Build, treeName: string, points: number): Build {
  // Always spend in the deepest tier that's open, so points climb the tree.
  const talents = [...warrior.trees[tree(treeName)].talents].sort(
    (x, y) => y.tier - x.tier || x.col - y.col,
  );
  let guard = 0;
  while (points > 0 && guard++ < 500) {
    const next = talents.find((t) => b.canAdd(t.id));
    if (!next) break;
    b = b.add(next.id);
    points--;
  }
  return b;
}

describe("Build rules", () => {
  it("gates tiers behind 5 points per tier", () => {
    const ms = talent("Arms", "Mortal Strike");
    expect(fresh().canAdd(ms.id)).toBe(false);
    expect(fresh().addBlocker(ms.id)).toMatch(/Requires 30 points/);
  });

  it("tracks level and caps at 51 points", () => {
    let b = fill(fresh(), "Arms", 31);
    b = fill(b, "Fury", 30);
    expect(b.spent).toBe(MAX_POINTS);
    expect(b.level).toBe(60);
    const any = warrior.trees[2].talents[0];
    expect(b.addBlocker(any.id)).toMatch(/No points left|Max rank/);
  });

  it("refuses removals that would break higher tiers", () => {
    const b = fill(fresh(), "Arms", 11);
    const tier0 = warrior.trees[tree("Arms")].talents.find((t) => t.tier === 0 && b.rank(t.id) > 0)!;
    // Exactly 5 points sit in tier 0, so every tier-1 point depends on all of them.
    const tier0Points = [...b.ranks].filter(([id]) => idx.byId.get(id)!.tier === 0).reduce((n, [, r]) => n + r, 0);
    expect(tier0Points).toBe(5);
    expect(Math.max(...[...b.ranks.keys()].map((id) => idx.byId.get(id)!.tier))).toBeGreaterThan(0);
    expect(b.canRemove(tier0.id)).toBe(false);
  });

  it("repairs the leveling order when a point is removed", () => {
    let b = fill(fresh(), "Arms", 10);
    // Add a spare tier-0 point at the end, then remove the first point spent: the
    // final build is legal, but the tier-1 picks now depend on the late spare point.
    const extra = warrior.trees[tree("Arms")].talents.find((t) => t.tier === 0 && b.canAdd(t.id))!;
    b = b.add(extra.id);
    const first = b.order[0];
    expect(b.canRemove(first)).toBe(true);
    const before = b.order.slice(1);
    b = b.remove(first);
    expect(b.spent).toBe(10);
    expect(b.order).not.toEqual(before.slice(0, 10)); // order was repaired
    for (let n = 0; n <= b.spent; n++) expect(b.truncate(n).spent).toBe(n);
  });
});

describe("share codes", () => {
  it("round-trips the leveling order", () => {
    let b = fill(fresh(), "Protection", 31);
    b = fill(b, "Arms", 20);
    const code = encode(b.order);
    expect(code.length).toBe(b.spent * 3);
    expect(decode(code)).toEqual(b.order);
    expect(new Build(idx, 3, decode(code)).order).toEqual(b.order);
  });

  it("drops invalid picks from tampered codes", () => {
    const ms = talent("Arms", "Mortal Strike");
    expect(new Build(idx, 3, decode(encode([ms.id]))).spent).toBe(0);
  });
});

describe("diffWords", async () => {
  const { diffWords } = await import("./ui");
  it("groups consecutive changed words into one run", () => {
    const d = diffWords("Increases damage by 5% for 10 sec.", "Increases all damage by 10% for 10 sec.");
    expect(d.after).toBe("Increases <ins>all</ins> damage by <ins>10%</ins> for 10 sec.");
    expect(d.before).toBe("Increases damage by <del>5%</del> for 10 sec.");
    const r = diffWords("Stuns the opponent for 5 sec.", "Roots the enemy target for 5 sec.");
    expect(r.after).toBe("<ins>Roots</ins> the <ins>enemy target</ins> for 5 sec.");
  });
});

describe("compareBuilds", async () => {
  const { compareBuilds } = await import("./build");
  it("lists rank differences and where the leveling order diverges", () => {
    const a = fill(fresh(), "Arms", 12);
    const b = fill(a.truncate(8), "Fury", 4);
    const d = compareBuilds(a, b);
    expect(d.divergesAt).toBe(18); // point 9 is the first that differs
    expect(d.trees[tree("Fury")]).toEqual({ a: 0, b: 4 });
    const total = (side: "a" | "b") => d.deltas.reduce((n, x) => n + x[side], 0);
    // Shared points cancel out: the deltas cover exactly the non-shared ranks.
    expect(total("b") - total("a")).toBe(b.spent - a.spent);
    expect(compareBuilds(a, a).deltas).toEqual([]);
    expect(compareBuilds(a, a).divergesAt).toBeNull();
  });
});
