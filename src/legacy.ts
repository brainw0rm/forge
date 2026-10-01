// Legacy point rules: an account-wide pool (16 points at launch) spread over three trees.
// Nodes unlock after spending points in the same tree and may require another node first.

import type { LegacyData, LegacyNode } from "./data";

export class LegacyPlan {
  readonly order: number[] = [];
  readonly ranks = new Map<number, number>();
  private readonly nodes = new Map<number, { node: LegacyNode; tree: number }>();

  constructor(
    readonly data: LegacyData,
    order: number[] = [],
  ) {
    data.trees.forEach((t, ti) => t.nodes.forEach((node) => this.nodes.set(node.id, { node, tree: ti })));
    for (const id of order) if (this.canAdd(id)) this.push(id);
  }

  get spent() {
    return this.order.length;
  }

  rank(id: number) {
    return this.ranks.get(id) ?? 0;
  }

  maxRank(id: number) {
    return this.nodes.get(id)?.node.options[0].ranks.length ?? 0;
  }

  treeSpent(tree: number) {
    let n = 0;
    for (const [id, r] of this.ranks) if (this.nodes.get(id)!.tree === tree) n += r;
    return n;
  }

  node(id: number) {
    return this.nodes.get(id)?.node;
  }

  addBlocker(id: number): string | null {
    const found = this.nodes.get(id);
    if (!found) return "Unknown bonus";
    const { node, tree } = found;
    if (node.placeholder) return "Coming in a future update";
    if (this.rank(id) >= this.maxRank(id)) return "Max rank";
    if (this.spent >= this.data.cap) return `All ${this.data.cap} Legacy points are spent`;
    if (this.treeSpent(tree) < node.req) return `Requires ${node.req} points in this tree`;
    if (node.prereq !== null) {
      const p = this.nodes.get(node.prereq)?.node;
      if (p && this.rank(p.id) < this.maxRank(p.id)) return `Requires ${p.options[0].name} at max rank`;
    }
    return null;
  }

  canAdd(id: number) {
    return this.addBlocker(id) === null;
  }

  add(id: number) {
    return this.canAdd(id) ? new LegacyPlan(this.data, [...this.order, id]) : this;
  }

  /** Remove the latest point in `id`, then drop anything no longer allowed. */
  remove(id: number) {
    const i = this.order.lastIndexOf(id);
    if (i < 0) return this;
    const rest = [...this.order.slice(0, i), ...this.order.slice(i + 1)];
    // Re-add greedily so points that still qualify stay, whatever order they came in.
    let plan = new LegacyPlan(this.data);
    let pending = rest;
    for (let changed = true; changed && pending.length; ) {
      changed = false;
      const next: number[] = [];
      for (const n of pending) {
        if (plan.canAdd(n)) {
          plan = plan.add(n);
          changed = true;
        } else next.push(n);
      }
      pending = next;
    }
    return plan;
  }

  private push(id: number) {
    this.order.push(id);
    this.ranks.set(id, this.rank(id) + 1);
  }
}
