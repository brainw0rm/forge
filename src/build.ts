// Talent build rules, leveling order and share codes. Pure logic, no DOM.
//
// A build is an ordered list of talent IDs, one entry per point spent. The order
// *is* the leveling path: point N is spent at character level 9 + N.

import type { ClassData, Talent } from "./data";

export const MAX_POINTS = 51;
export const FIRST_TALENT_LEVEL = 10;
export const POINTS_PER_TIER = 5;

export interface Index {
  byId: Map<number, Talent>;
  treeOf: Map<number, number>; // talent id -> tree index
  dependents: Map<number, Talent[]>; // talent id -> talents that require it
}

export function indexClass(cls: ClassData): Index {
  const byId = new Map<number, Talent>();
  const treeOf = new Map<number, number>();
  const dependents = new Map<number, Talent[]>();
  cls.trees.forEach((tree, ti) =>
    tree.talents.forEach((t) => {
      byId.set(t.id, t);
      treeOf.set(t.id, ti);
    }),
  );
  for (const t of byId.values()) {
    if (t.prereq) {
      const list = dependents.get(t.prereq.id) ?? [];
      list.push(t);
      dependents.set(t.prereq.id, list);
    }
  }
  return { byId, treeOf, dependents };
}

/** Points that must be spent in lower tiers of the same tree (from the game data, else 5 per tier). */
export const required = (t: Talent) => t.req ?? t.tier * POINTS_PER_TIER;

export class Build {
  readonly order: number[];
  readonly ranks: Map<number, number>;
  readonly treePoints: number[];

  constructor(
    readonly idx: Index,
    readonly treeCount: number,
    order: number[] = [],
  ) {
    this.order = [];
    this.ranks = new Map();
    this.treePoints = new Array(treeCount).fill(0);
    for (const id of order) if (this.canAdd(id)) this.push(id);
  }

  get spent() {
    return this.order.length;
  }

  /** Character level needed for this build. */
  get level() {
    return this.spent === 0 ? 1 : FIRST_TALENT_LEVEL - 1 + this.spent;
  }

  rank(id: number) {
    return this.ranks.get(id) ?? 0;
  }

  /** Points spent in tiers below `tier` of a tree. */
  pointsBelow(tree: number, tier: number) {
    let n = 0;
    for (const [id, r] of this.ranks) {
      const t = this.idx.byId.get(id)!;
      if (this.idx.treeOf.get(id) === tree && t.tier < tier) n += r;
    }
    return n;
  }

  /** Why a point can't be added, or null if it can. */
  addBlocker(id: number): string | null {
    const t = this.idx.byId.get(id);
    if (!t) return "Unknown talent";
    if (this.rank(id) >= t.ranks.length) return "Max rank";
    if (this.spent >= MAX_POINTS) return "No points left";
    const tree = this.idx.treeOf.get(id)!;
    const need = required(t);
    if (this.pointsBelow(tree, t.tier) < need)
      return `Requires ${need} points in this tree`;
    if (t.prereq) {
      const p = this.idx.byId.get(t.prereq.id);
      if (p && this.rank(p.id) < t.prereq.rank)
        return `Requires ${t.prereq.rank} point${t.prereq.rank > 1 ? "s" : ""} in ${p.name}`;
    }
    return null;
  }

  canAdd(id: number) {
    return this.addBlocker(id) === null;
  }

  /** Why a point can't be removed, or null if it can. */
  removeBlocker(id: number): string | null {
    const r = this.rank(id);
    if (r === 0) return "No points to remove";
    const t = this.idx.byId.get(id)!;
    for (const dep of this.idx.dependents.get(id) ?? []) {
      if (this.rank(dep.id) > 0 && dep.prereq && r - 1 < dep.prereq.rank)
        return `${dep.name} depends on it`;
    }
    // Every invested tier above must still have enough points below it.
    const tree = this.idx.treeOf.get(id)!;
    for (const [oid, orank] of this.ranks) {
      if (orank === 0 || this.idx.treeOf.get(oid) !== tree) continue;
      const o = this.idx.byId.get(oid)!;
      if (o.tier <= t.tier) continue;
      if (this.pointsBelow(tree, o.tier) - 1 < required(o))
        return `${o.name} needs the points below it`;
    }
    return null;
  }

  canRemove(id: number) {
    return this.removeBlocker(id) === null;
  }

  private push(id: number) {
    this.order.push(id);
    this.ranks.set(id, this.rank(id) + 1);
    this.treePoints[this.idx.treeOf.get(id)!]++;
  }

  add(id: number): Build {
    if (!this.canAdd(id)) return this;
    return new Build(this.idx, this.treeCount, [...this.order, id]);
  }

  /** Remove one point (the latest one spent in that talent) and repair the order. */
  remove(id: number): Build {
    if (!this.canRemove(id)) return this;
    const i = this.order.lastIndexOf(id);
    const rest = [...this.order.slice(0, i), ...this.order.slice(i + 1)];
    return new Build(this.idx, this.treeCount, repairOrder(this.idx, this.treeCount, rest));
  }

  /** The build as it looked after the first `points` points. */
  truncate(points: number): Build {
    return new Build(this.idx, this.treeCount, this.order.slice(0, points));
  }

  /** Move point `from` to position `to` in the leveling order, if the result is valid. */
  reorder(from: number, to: number): Build {
    const next = [...this.order];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    const b = new Build(this.idx, this.treeCount, next);
    return b.spent === this.spent ? b : this;
  }
}

/**
 * Reorder picks so every prefix is a legal build, keeping the user's order where
 * possible. Needed after removing a point that later picks relied on.
 */
export function repairOrder(idx: Index, treeCount: number, order: number[]): number[] {
  const pending = [...order];
  const out: number[] = [];
  let b = new Build(idx, treeCount);
  while (pending.length) {
    const i = pending.findIndex((id) => b.canAdd(id));
    if (i < 0) break; // remaining picks are invalid on their own; drop them
    const [id] = pending.splice(i, 1);
    out.push(id);
    b = new Build(idx, treeCount, out);
  }
  return out;
}

export { CHARS_PER_POINT, decode, encode } from "../shared/code";

/** "31/20/0"-style summary. */
export function split(b: Build) {
  return b.treePoints.join("/");
}

// ---------------------------------------------------------------- comparing builds

export interface TalentDelta {
  id: number;
  a: number;
  b: number;
}

export interface BuildDiff {
  /** Talents whose rank differs, in tree/tier/column order. */
  deltas: TalentDelta[];
  /** Points in each tree for A and B. */
  trees: { a: number; b: number }[];
  /** First character level where the leveling orders differ, or null if one is a prefix of the other. */
  divergesAt: number | null;
}

export function compareBuilds(a: Build, b: Build): BuildDiff {
  const ids = new Set([...a.ranks.keys(), ...b.ranks.keys()]);
  const deltas = [...ids]
    .map((id) => ({ id, a: a.rank(id), b: b.rank(id) }))
    .filter((d) => d.a !== d.b)
    .sort((x, y) => {
      const tx = a.idx.byId.get(x.id)!;
      const ty = a.idx.byId.get(y.id)!;
      return (
        a.idx.treeOf.get(x.id)! - a.idx.treeOf.get(y.id)! || tx.tier - ty.tier || tx.col - ty.col
      );
    });
  const n = Math.min(a.order.length, b.order.length);
  let i = 0;
  while (i < n && a.order[i] === b.order[i]) i++;
  return {
    deltas,
    trees: a.treePoints.map((p, ti) => ({ a: p, b: b.treePoints[ti] })),
    divergesAt: i < n ? FIRST_TALENT_LEVEL + i : null,
  };
}
