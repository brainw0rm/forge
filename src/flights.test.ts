import { describe, expect, it } from "vitest";
import { money, planRoute, type FlightNode, type FlightPath } from "./views/flights";

const node = (id: number, x: number): FlightNode => ({ id, name: `P${id}`, zone: "Z", continent: 0, faction: "both", x, y: 0.5, isNew: false });
const nodes = new Map([1, 2, 3, 4, 5].map((id) => [id, node(id, id / 10)]));

describe("flight route planner", () => {
  // 1 → 3 directly is a long way round; 1 → 2 → 3 is shorter. 4 only flies one way to 3. 5 has no routes.
  const paths: FlightPath[] = [
    { a: 1, b: 3, costAB: 500, costBA: 500, distAB: 9000, distBA: 9000, isNew: false },
    { a: 1, b: 2, costAB: 100, costBA: 120, distAB: 2000, distBA: 2000, isNew: false },
    { a: 2, b: 3, costAB: 150, costBA: 150, distAB: 2500, distBA: 2500, isNew: true },
    { a: 3, b: 4, costBA: 80, distBA: 1000, isNew: false },
  ];

  it("takes the shortest trip by distance flown and prices each leg in its direction", () => {
    const legs = planRoute(nodes, paths, 1, 3)!;
    expect(legs.map((l) => [l.from.id, l.to.id, l.cost])).toEqual([[1, 2, 100], [2, 3, 150]]);
    expect(legs[1].isNew).toBe(true);
    expect(planRoute(nodes, paths, 2, 1)!.map((l) => l.cost)).toEqual([120]);
  });

  it("respects one-way routes and reports unreachable destinations", () => {
    expect(planRoute(nodes, paths, 4, 3)!.map((l) => l.to.id)).toEqual([3]);
    expect(planRoute(nodes, paths, 3, 4)).toBeNull();
    expect(planRoute(nodes, paths, 1, 5)).toBeNull();
    expect(planRoute(nodes, paths, 1, 1)).toEqual([]);
  });

  it("formats copper as gold, silver and copper", () => {
    expect(money(840)).toBe("8s 40c");
    expect(money(12000)).toBe("1g 20s");
    expect(money(0)).toBe("free");
  });
});
