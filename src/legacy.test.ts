import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LegacyData } from "./data";
import { LegacyPlan } from "./legacy";

const data: LegacyData = JSON.parse(readFileSync(new URL("../public/data/legacy.json", import.meta.url), "utf8"));
const byName = (name: string) =>
  data.trees.flatMap((t) => t.nodes).find((n) => n.options[0].name === name)!;

describe("Legacy planner", () => {
  it("has three trees and a 16-point cap from the client data", () => {
    expect(data.trees).toHaveLength(3);
    expect(data.cap).toBe(16);
  });

  it("gates nodes behind points spent in the same tree and prerequisites", () => {
    const gated = data.trees[1].nodes.find((n) => n.req === 5 && n.prereq === null && !n.placeholder)!;
    expect(new LegacyPlan(data).addBlocker(gated.id)).toMatch(/Requires 5 points/);
    const free = data.trees[1].nodes.filter((n) => n.req === 0 && !n.placeholder);
    let plan = new LegacyPlan(data);
    for (const n of free) while (plan.canAdd(n.id) && plan.treeSpent(1) < 5) plan = plan.add(n.id);
    expect(plan.treeSpent(1)).toBe(5);
    expect(plan.canAdd(gated.id)).toBe(true);
  });

  it("never exceeds the cap and removes points that lose their requirement", () => {
    let plan = new LegacyPlan(data);
    const all = data.trees.flatMap((t) => t.nodes).filter((n) => !n.placeholder);
    for (let i = 0; i < 40; i++) {
      const next = all.find((n) => plan.canAdd(n.id));
      if (!next) break;
      plan = plan.add(next.id);
    }
    expect(plan.spent).toBe(16);
    // Removing a base point from a tree must also drop the nodes it unlocked.
    const tree = [0, 1, 2].find((t) => data.trees[t].nodes.some((n) => n.req > 0 && plan.rank(n.id) > 0))!;
    const base = data.trees[tree].nodes.find((n) => n.req === 0 && plan.rank(n.id) > 0)!;
    let trimmed = plan;
    while (trimmed.rank(base.id) > 0) trimmed = trimmed.remove(base.id);
    for (const n of data.trees[tree].nodes) {
      if (trimmed.rank(n.id) > 0) expect(trimmed.treeSpent(tree) >= n.req || n.req === 0).toBe(true);
    }
  });

  it("marks the client's placeholder nodes as unavailable", () => {
    const ph = data.trees[0].nodes.find((n) => n.placeholder)!;
    expect(new LegacyPlan(data).addBlocker(ph.id)).toMatch(/future update/);
    expect(byName("Talented").options[0].ranks).toHaveLength(5);
  });
});
