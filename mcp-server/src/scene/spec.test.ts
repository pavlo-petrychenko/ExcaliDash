import { describe, expect, it } from "vitest";
import { normalizeSkeleton, validateScene } from "./normalize.js";
import { SpecError, specToSkeleton } from "./spec.js";
import { LayoutError } from "./layout.js";
import { ROLE_PALETTE } from "../constants.js";
import type { DiagramSpec } from "../schemas/spec.js";
import { DiagramSpecSchema } from "../schemas/spec.js";

/** Parses through the real zod schema (applies defaults) so tests exercise the actual tool-input shape. */
function parseSpec(input: unknown): DiagramSpec {
  return DiagramSpecSchema.parse(input);
}

describe("specToSkeleton: shapes, roles, colors", () => {
  it("maps shape -> default role color when role/color are unset", () => {
    const spec = parseSpec({ nodes: [{ id: "a", label: "A", shape: "rectangle" }, { id: "b", label: "B", shape: "diamond" }] });
    const { skeleton } = specToSkeleton(spec);
    const a = skeleton.find((el) => (el as { id?: string }).id === "a") as { backgroundColor: string };
    const b = skeleton.find((el) => (el as { id?: string }).id === "b") as { backgroundColor: string };
    expect(a.backgroundColor).toBe(ROLE_PALETTE.process);
    expect(b.backgroundColor).toBe(ROLE_PALETTE.decision);
  });

  it("role overrides the shape default color", () => {
    const spec = parseSpec({ nodes: [{ id: "a", label: "A", shape: "rectangle", role: "accent" }] });
    const { skeleton } = specToSkeleton(spec);
    const a = skeleton.find((el) => (el as { id?: string }).id === "a") as { backgroundColor: string };
    expect(a.backgroundColor).toBe(ROLE_PALETTE.accent);
  });

  it("explicit color overrides role", () => {
    const spec = parseSpec({ nodes: [{ id: "a", label: "A", role: "accent", color: "#123456" }] });
    const { skeleton } = specToSkeleton(spec);
    const a = skeleton.find((el) => (el as { id?: string }).id === "a") as { backgroundColor: string };
    expect(a.backgroundColor).toBe("#123456");
  });
});

describe("specToSkeleton -> normalizeSkeleton: end-to-end validity", () => {
  it("produces a scene where edges bind to nodes by id with reciprocal bindings", async () => {
    const spec = parseSpec({
      nodes: [
        { id: "start", label: "Start", shape: "ellipse" },
        { id: "step", label: "Do the thing" },
        { id: "end", label: "End", shape: "ellipse" },
      ],
      edges: [
        { from: "start", to: "step", label: "go" },
        { from: "step", to: "end" },
      ],
    });
    const { skeleton } = specToSkeleton(spec);
    const { elements, warnings } = await normalizeSkeleton(skeleton);
    expect(warnings).toEqual([]);

    const { errors } = validateScene(elements);
    expect(errors).toEqual([]);

    const arrows = elements.filter((el) => el.type === "arrow");
    expect(arrows).toHaveLength(2);
    const first = arrows.find((el) => el.startBinding?.elementId === "start");
    expect(first?.endBinding?.elementId).toBe("step");
  });

  it("applies dashed/dotted style and 'none' arrowhead correctly", async () => {
    const spec = parseSpec({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b", style: "dashed", arrowhead: "none" }],
    });
    const { skeleton } = specToSkeleton(spec);
    const { elements } = await normalizeSkeleton(skeleton);
    const arrow = elements.find((el) => el.type === "arrow");
    expect(arrow?.type === "arrow" && arrow.strokeStyle).toBe("dashed");
    expect(arrow?.type === "arrow" && arrow.endArrowhead).toBeNull();
  });

  it("groups nodes sharing a `frame` name into an auto-sized frame element", async () => {
    const spec = parseSpec({
      nodes: [
        { id: "a", label: "A", frame: "group-1" },
        { id: "b", label: "B", frame: "group-1" },
        { id: "c", label: "C" },
      ],
    });
    const { skeleton } = specToSkeleton(spec);
    const { elements } = await normalizeSkeleton(skeleton);
    const frame = elements.find((el) => el.type === "frame");
    expect(frame).toBeDefined();
    const a = elements.find((el) => el.id === "a")!;
    const b = elements.find((el) => el.id === "b")!;
    const c = elements.find((el) => el.id === "c")!;
    expect((a as { frameId: string | null }).frameId).toBe(frame!.id);
    expect((b as { frameId: string | null }).frameId).toBe(frame!.id);
    expect((c as { frameId: string | null }).frameId).toBeNull();
  });

  it("places an optional title above the laid-out diagram bounds", async () => {
    const spec = parseSpec({
      title: "My Flow",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }],
    });
    const { skeleton } = specToSkeleton(spec);
    const { elements } = await normalizeSkeleton(skeleton);
    const title = elements.find((el) => el.type === "text" && el.text === "My Flow");
    expect(title).toBeDefined();
    const topNode = elements.find((el) => el.id === "a")!;
    expect(title!.y).toBeLessThan(topNode.y);
  });
});

describe("specToSkeleton -> normalizeSkeleton: arrow geometry (regression)", () => {
  it("gives a 2-node vertical flow's arrow a bbox spanning the gap between the nodes, not a degenerate point at the scene origin", async () => {
    // Regression for a bug where every edge's arrow skeleton kept x:0,y:0 with a fixed short
    // horizontal `points` pair regardless of where its bound nodes actually landed after layout —
    // every arrow in a rendered scene piled up as a tiny artifact at the origin instead of
    // connecting its nodes.
    const spec = parseSpec({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }],
      layout: { type: "flow", direction: "down" },
    });
    const { skeleton } = specToSkeleton(spec);
    const { elements } = await normalizeSkeleton(skeleton);

    const nodeA = elements.find((el) => el.id === "a")!;
    const nodeB = elements.find((el) => el.id === "b")!;
    const arrow = elements.find((el) => el.type === "arrow")!;

    const gapTop = nodeA.y + nodeA.height;
    const gapBottom = nodeB.y;
    expect(gapBottom).toBeGreaterThan(gapTop); // sanity: flow layout stacked them vertically

    // The old bug: arrow.y was always exactly 0, and arrow.height was always exactly 0 (a fixed
    // ~100-wide horizontal segment), no matter where the nodes were.
    expect(arrow.y).not.toBe(0);
    expect(arrow.y).toBeGreaterThanOrEqual(gapTop - 1);
    expect(arrow.y + arrow.height).toBeLessThanOrEqual(gapBottom + 1);
    expect(arrow.height).toBeGreaterThan((gapBottom - gapTop) * 0.5);
  });

  it("gives a diagonal (grid-layout) edge's arrow a bbox spanning both axes, not a flat horizontal segment", async () => {
    const spec = parseSpec({
      nodes: [
        { id: "a", label: "A", x: 0, y: 0 },
        { id: "b", label: "B", x: 400, y: 300 },
      ],
      edges: [{ from: "a", to: "b" }],
      layout: { type: "manual" },
    });
    const { skeleton } = specToSkeleton(spec);
    const { elements } = await normalizeSkeleton(skeleton);
    const arrow = elements.find((el) => el.type === "arrow")!;

    // A diagonal span must move on both axes — the old bug always produced height 0.
    expect(arrow.width).toBeGreaterThan(0);
    expect(arrow.height).toBeGreaterThan(0);
  });
});

describe("specToSkeleton: validation errors", () => {
  it("throws SpecError for duplicate node ids", () => {
    const spec = parseSpec({ nodes: [{ id: "a", label: "A" }, { id: "a", label: "A again" }] });
    expect(() => specToSkeleton(spec)).toThrow(SpecError);
  });

  it("throws SpecError for an edge referencing an unknown node", () => {
    const spec = parseSpec({ nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "nope" }] });
    expect(() => specToSkeleton(spec)).toThrow(SpecError);
  });

  it("throws LayoutError when layout.type is 'manual' and a node is missing x/y", () => {
    const spec = parseSpec({ nodes: [{ id: "a", label: "A" }], layout: { type: "manual" } });
    expect(() => specToSkeleton(spec)).toThrow(LayoutError);
  });
});

describe("DiagramSpecSchema: strictness", () => {
  it("rejects unknown top-level fields", () => {
    expect(() => DiagramSpecSchema.parse({ nodes: [{ id: "a", label: "A" }], bogus: true })).toThrow();
  });

  it("rejects unknown node fields", () => {
    expect(() => DiagramSpecSchema.parse({ nodes: [{ id: "a", label: "A", bogus: true }] })).toThrow();
  });

  it("requires at least one node", () => {
    expect(() => DiagramSpecSchema.parse({ nodes: [] })).toThrow();
  });
});
