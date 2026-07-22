import { describe, expect, it } from "vitest";
import { normalizeSkeleton } from "../scene/normalize.js";
import type { ExcalidrawElementSkeleton } from "../scene/excalidrawVendor.js";
import { CropError, selectElementsForRender } from "./crop.js";

const TWO_BOX_ARROW: ExcalidrawElementSkeleton[] = [
  { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "a", label: { text: "A" } } as ExcalidrawElementSkeleton,
  { type: "rectangle", x: 400, y: 0, width: 180, height: 80, id: "b", label: { text: "B" } } as ExcalidrawElementSkeleton,
  { type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } } as ExcalidrawElementSkeleton,
];

describe("selectElementsForRender: mode full", () => {
  it("returns every non-deleted element", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    const result = await selectElementsForRender({ elements, mode: "full" });
    expect(result.elements).toHaveLength(elements.length);
    expect(result.warnings).toEqual([]);
  });
});

describe("selectElementsForRender: mode elements", () => {
  it("pulls in a container's bound label text and its bound arrow (bound partners)", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    const boxA = elements.find((el) => el.id === "a")!;
    const arrow = elements.find((el) => el.type === "arrow")!;
    const labelA = elements.find((el) => el.type === "text" && el.containerId === "a")!;

    const result = await selectElementsForRender({ elements, mode: "elements", elementIds: ["a"] });
    const ids = result.elements.map((el) => el.id);

    expect(ids).toContain(boxA.id);
    expect(ids).toContain(labelA.id);
    expect(ids).toContain(arrow.id);
    // Box B is not itself bound to box A (only the arrow's start/end reference it,
    // which is deliberately not one of the plan's 4 pull-in categories — research
    // 07 §7.5: an unbound-looking far endpoint still renders fine).
    expect(ids).not.toContain("b");
  });

  it("pulling in a bound text element also pulls in its container", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    const labelA = elements.find((el) => el.type === "text" && el.containerId === "a")!;

    const result = await selectElementsForRender({ elements, mode: "elements", elementIds: [labelA.id] });
    const ids = result.elements.map((el) => el.id);
    expect(ids).toContain("a");
  });

  it("warns (without throwing) for an unknown element id", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    const result = await selectElementsForRender({ elements, mode: "elements", elementIds: ["a", "does-not-exist"] });
    expect(result.warnings.some((w) => w.includes("does-not-exist"))).toBe(true);
    expect(result.elements.map((el) => el.id)).toContain("a");
  });

  it("throws CropError for an empty element_ids list", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    await expect(selectElementsForRender({ elements, mode: "elements", elementIds: [] })).rejects.toThrow(CropError);
  });
});

describe("selectElementsForRender: mode region", () => {
  it("includes only elements overlapping the requested bbox, plus bound partners", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    // Region tightly around box A (0,0,180,80) only.
    const result = await selectElementsForRender({
      elements,
      mode: "region",
      region: { x: -10, y: -10, width: 200, height: 100 },
    });
    const ids = result.elements.map((el) => el.id);
    expect(ids).toContain("a");
    expect(ids).not.toContain("b");
  });

  it("warns when nothing overlaps the region", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    const result = await selectElementsForRender({
      elements,
      mode: "region",
      region: { x: 5000, y: 5000, width: 10, height: 10 },
    });
    expect(result.elements).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("throws CropError when region is missing", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    await expect(selectElementsForRender({ elements, mode: "region" })).rejects.toThrow(CropError);
  });
});

describe("selectElementsForRender: mode frame", () => {
  it("returns the full element set plus the exportingFrame handle when the frame exists", async () => {
    const skeleton: ExcalidrawElementSkeleton[] = [
      ...TWO_BOX_ARROW,
      { type: "frame", name: "Group 1", children: ["a"] } as ExcalidrawElementSkeleton,
    ];
    const { elements } = await normalizeSkeleton(skeleton);
    const frame = elements.find((el) => el.type === "frame")!;

    const result = await selectElementsForRender({ elements, mode: "frame", frameId: frame.id });
    expect(result.exportingFrame?.id).toBe(frame.id);
    expect(result.elements).toHaveLength(elements.length);
  });

  it("warns and falls back to the full scene when frame_id is not found", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    const result = await selectElementsForRender({ elements, mode: "frame", frameId: "no-such-frame" });
    expect(result.exportingFrame).toBeUndefined();
    expect(result.elements).toHaveLength(elements.length);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("throws CropError when frame_id is missing", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW);
    await expect(selectElementsForRender({ elements, mode: "frame" })).rejects.toThrow(CropError);
  });
});
