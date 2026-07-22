import { describe, expect, it } from "vitest";
import { validateScene } from "./normalize.js";
import { normalizeSkeleton } from "./normalize.js";
import { DEFAULT_RELAYOUT_OPTIONS, relayoutScene, RelayoutError } from "./relayout.js";
import type { ExcalidrawElementSkeleton } from "./excalidrawVendor.js";

async function makeFlowScene() {
  const skeleton: ExcalidrawElementSkeleton[] = [
    { type: "rectangle", x: 999, y: 999, width: 180, height: 80, id: "a", label: { text: "Start" } } as ExcalidrawElementSkeleton,
    { type: "rectangle", x: 999, y: 999, width: 180, height: 80, id: "b", label: { text: "End" } } as ExcalidrawElementSkeleton,
    { type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" }, label: { text: "next" } } as ExcalidrawElementSkeleton,
  ];
  return normalizeSkeleton(skeleton);
}

describe("relayoutScene", () => {
  it("repositions nodes into a fresh flow layout and preserves labels/bindings", async () => {
    const { elements: original } = await makeFlowScene();
    const { elements } = await relayoutScene(original, DEFAULT_RELAYOUT_OPTIONS);

    const a = elements.find((el) => el.id === "a")!;
    const b = elements.find((el) => el.id === "b")!;
    // "down" direction: b's rank is strictly below a's rank.
    expect(b.y).toBeGreaterThan(a.y);

    const arrow = elements.find((el) => el.type === "arrow")!;
    expect(arrow.type === "arrow" || arrow.type === "line").toBe(true);
    if (arrow.type === "arrow" || arrow.type === "line") {
      expect(arrow.startBinding?.elementId).toBe("a");
      expect(arrow.endBinding?.elementId).toBe("b");
    }

    const { errors } = validateScene(elements);
    expect(errors).toEqual([]);
  });

  it("preserves node label text and arrow label text through the rebuild", async () => {
    const { elements: original } = await makeFlowScene();
    const { elements } = await relayoutScene(original, DEFAULT_RELAYOUT_OPTIONS);

    const labels = elements.filter((el) => el.type === "text").map((el) => (el.type === "text" ? el.text : ""));
    expect(labels).toContain("Start");
    expect(labels).toContain("End");
    expect(labels).toContain("next");
  });

  it("is idempotent-ish: relaying out an already-laid-out scene doesn't error and keeps 2 nodes + 1 arrow", async () => {
    const { elements: original } = await makeFlowScene();
    const once = await relayoutScene(original, DEFAULT_RELAYOUT_OPTIONS);
    const twice = await relayoutScene(once.elements, DEFAULT_RELAYOUT_OPTIONS);
    const liveTypes = twice.elements.filter((el) => !el.isDeleted).map((el) => el.type);
    expect(liveTypes.filter((t) => t === "rectangle")).toHaveLength(2);
    expect(liveTypes.filter((t) => t === "arrow")).toHaveLength(1);
  });

  it("rejects a scene containing an unsupported element type (e.g. a frame)", async () => {
    const { elements: original } = await normalizeSkeleton([
      { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "a" } as ExcalidrawElementSkeleton,
      { type: "frame", name: "Group", children: ["a"] } as ExcalidrawElementSkeleton,
    ]);
    await expect(relayoutScene(original, DEFAULT_RELAYOUT_OPTIONS)).rejects.toBeInstanceOf(RelayoutError);
  });

  it("rejects a scene with an unbound arrow (dangling coordinates, no start/end binding)", async () => {
    const { elements: original } = await normalizeSkeleton([
      { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "a" } as ExcalidrawElementSkeleton,
      { type: "rectangle", x: 400, y: 0, width: 180, height: 80, id: "b" } as ExcalidrawElementSkeleton,
      { type: "arrow", x: 0, y: 0, points: [[0, 0], [100, 100]] } as ExcalidrawElementSkeleton,
    ]);
    await expect(relayoutScene(original, DEFAULT_RELAYOUT_OPTIONS)).rejects.toBeInstanceOf(RelayoutError);
  });

  it("supports the grid layout option too", async () => {
    const { elements: original } = await makeFlowScene();
    const { elements } = await relayoutScene(original, { ...DEFAULT_RELAYOUT_OPTIONS, type: "grid" });
    const { errors } = validateScene(elements);
    expect(errors).toEqual([]);
  });
});
