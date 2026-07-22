import { describe, expect, it } from "vitest";
import { computeLayout, LayoutError, type LayoutEdgeInput, type LayoutNodeInput, type LayoutOptions } from "./layout.js";

const BASE_OPTIONS: LayoutOptions = { type: "flow", direction: "down", spacingX: 120, spacingY: 100 };

function box(id: string, extra: Partial<LayoutNodeInput> = {}): LayoutNodeInput {
  return { id, width: 180, height: 80, ...extra };
}

/** Two boxes overlap iff their axis-aligned rectangles intersect (touching edges are fine). */
function rectanglesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function assertNoOverlaps(nodes: readonly LayoutNodeInput[], positions: ReadonlyMap<string, { x: number; y: number }>): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = { ...positions.get(nodes[i]!.id)!, width: nodes[i]!.width, height: nodes[i]!.height };
      const b = { ...positions.get(nodes[j]!.id)!, width: nodes[j]!.width, height: nodes[j]!.height };
      expect(rectanglesOverlap(a, b)).toBe(false);
    }
  }
}

describe("computeLayout: flow", () => {
  it("ranks a simple chain left-to-right by input order, top-to-bottom by rank", () => {
    const nodes = [box("a"), box("b"), box("c")];
    const edges: LayoutEdgeInput[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const positions = computeLayout(nodes, edges, BASE_OPTIONS);
    expect(positions.get("a")!.y).toBeLessThan(positions.get("b")!.y);
    expect(positions.get("b")!.y).toBeLessThan(positions.get("c")!.y);
    assertNoOverlaps(nodes, positions);
  });

  it("places a diamond (one root fanning out, then converging) without overlap", () => {
    const nodes = [box("start"), box("left"), box("right"), box("end")];
    const edges: LayoutEdgeInput[] = [
      { from: "start", to: "left" },
      { from: "start", to: "right" },
      { from: "left", to: "end" },
      { from: "right", to: "end" },
    ];
    const positions = computeLayout(nodes, edges, BASE_OPTIONS);
    expect(positions.get("start")!.y).toBeLessThan(positions.get("left")!.y);
    expect(positions.get("left")!.y).toBe(positions.get("right")!.y);
    expect(positions.get("left")!.x).not.toBe(positions.get("right")!.x);
    expect(positions.get("end")!.y).toBeGreaterThan(positions.get("left")!.y);
    assertNoOverlaps(nodes, positions);
  });

  it("breaks a cycle for ranking purposes but still lays out every node without overlap", () => {
    const nodes = [box("a"), box("b"), box("c")];
    const edges: LayoutEdgeInput[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" }, // back-edge closing the cycle
    ];
    const positions = computeLayout(nodes, edges, BASE_OPTIONS);
    expect(positions.size).toBe(3);
    assertNoOverlaps(nodes, positions);
  });

  it("lays out a single node with no edges", () => {
    const nodes = [box("only")];
    const positions = computeLayout(nodes, [], BASE_OPTIONS);
    expect(positions.get("only")).toEqual({ x: 0, y: 0 });
  });

  it("is deterministic across repeated calls with the same input", () => {
    const nodes = [box("a"), box("b"), box("c"), box("d")];
    const edges: LayoutEdgeInput[] = [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ];
    const first = computeLayout(nodes, edges, BASE_OPTIONS);
    const second = computeLayout(nodes, edges, BASE_OPTIONS);
    for (const node of nodes) {
      expect(second.get(node.id)).toEqual(first.get(node.id));
    }
  });

  it("clusters same-group nodes within a rank", () => {
    const nodes = [
      box("a1", { group: "a" }),
      box("b1", { group: "b" }),
      box("a2", { group: "a" }),
      box("b2", { group: "b" }),
    ];
    const positions = computeLayout(nodes, [], BASE_OPTIONS);
    // All four are isolated roots -> single rank; group members should be adjacent by x.
    const byX = [...positions.entries()].sort((x, y) => x[1].x - y[1].x).map(([id]) => id);
    const groupSequence = byX.map((id) => id[0]);
    // Either "aabb" or "bbaa" — both cluster each group together.
    expect(groupSequence.join("")).toMatch(/^(aabb|bbaa)$/);
  });

  it("respects a custom direction:'right' by stacking ranks along x", () => {
    const nodes = [box("a"), box("b")];
    const edges: LayoutEdgeInput[] = [{ from: "a", to: "b" }];
    const positions = computeLayout(nodes, edges, { ...BASE_OPTIONS, direction: "right" });
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
    expect(positions.get("a")!.y).toBe(positions.get("b")!.y);
  });

  it("throws LayoutError when an edge references an unknown node", () => {
    const nodes = [box("a")];
    expect(() => computeLayout(nodes, [{ from: "a", to: "nope" }], BASE_OPTIONS)).toThrow(LayoutError);
  });

  it("guarantees no overlap even with mismatched node sizes", () => {
    const nodes = [box("big", { width: 400, height: 200 }), box("small", { width: 50, height: 30 }), box("mid")];
    const edges: LayoutEdgeInput[] = [
      { from: "big", to: "small" },
      { from: "big", to: "mid" },
    ];
    const positions = computeLayout(nodes, edges, BASE_OPTIONS);
    assertNoOverlaps(nodes, positions);
  });
});

describe("computeLayout: grid", () => {
  it("wraps nodes into ceil(sqrt(n)) columns without overlap", () => {
    const nodes = Array.from({ length: 9 }, (_, i) => box(`n${i}`));
    const positions = computeLayout(nodes, [], { ...BASE_OPTIONS, type: "grid" });
    // 9 nodes -> 3 columns; the 4th node (index 3) should start a new row (y increases, x resets to the first column's x).
    expect(positions.get("n0")!.x).toBe(positions.get("n3")!.x);
    expect(positions.get("n3")!.y).toBeGreaterThan(positions.get("n0")!.y);
    assertNoOverlaps(nodes, positions);
  });

  it("is deterministic and independent of edges", () => {
    const nodes = [box("a"), box("b"), box("c"), box("d")];
    const first = computeLayout(nodes, [], { ...BASE_OPTIONS, type: "grid" });
    const second = computeLayout(nodes, [{ from: "a", to: "b" }], { ...BASE_OPTIONS, type: "grid" });
    for (const node of nodes) {
      expect(second.get(node.id)).toEqual(first.get(node.id));
    }
  });
});

describe("computeLayout: manual", () => {
  it("passes through explicit x/y unchanged", () => {
    const nodes = [box("a", { x: 10, y: 20 }), box("b", { x: 300, y: 20 })];
    const positions = computeLayout(nodes, [], { ...BASE_OPTIONS, type: "manual" });
    expect(positions.get("a")).toEqual({ x: 10, y: 20 });
    expect(positions.get("b")).toEqual({ x: 300, y: 20 });
  });

  it("throws LayoutError listing nodes missing x/y", () => {
    const nodes = [box("a", { x: 0, y: 0 }), box("b")];
    expect(() => computeLayout(nodes, [], { ...BASE_OPTIONS, type: "manual" })).toThrow(/\bb\b/);
  });
});
