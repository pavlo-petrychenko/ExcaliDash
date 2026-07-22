import { describe, expect, it } from "vitest";
import { applyOps, OpsError } from "./ops.js";
import { normalizeSkeleton, validateScene } from "./normalize.js";
import type { ExcalidrawElementSkeleton } from "./excalidrawVendor.js";

async function makeTwoBoxScene() {
  const skeleton: ExcalidrawElementSkeleton[] = [
    { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "a", label: { text: "A" } } as ExcalidrawElementSkeleton,
    { type: "rectangle", x: 400, y: 0, width: 180, height: 80, id: "b", label: { text: "B" } } as ExcalidrawElementSkeleton,
  ];
  return normalizeSkeleton(skeleton);
}

describe("applyOps: add", () => {
  it("binds a newly-added arrow to a pre-existing node by id", async () => {
    const { elements: current } = await makeTwoBoxScene();
    const { elements } = await applyOps(current, [
      {
        action: "add",
        skeleton: [{ type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } } as ExcalidrawElementSkeleton],
      },
    ]);

    const arrow = elements.find((el) => el.type === "arrow");
    expect(arrow).toBeDefined();
    if (arrow?.type === "arrow" || arrow?.type === "line") {
      expect(arrow.startBinding?.elementId).toBe("a");
      expect(arrow.endBinding?.elementId).toBe("b");
    }
    const boxA = elements.find((el) => el.id === "a")!;
    expect(boxA.boundElements?.some((bound) => bound.type === "arrow" && bound.id === arrow!.id)).toBe(true);

    const { errors } = validateScene(elements);
    expect(errors).toEqual([]);
  });

  it("appends raw elements untouched (elements input path)", async () => {
    const { elements: current } = await makeTwoBoxScene();
    // A fresh, unbound copy (not `current[0]`'s boundElements, which point at a
    // text child this new element doesn't own — that would be a genuinely
    // broken scene, not this test's concern).
    const extra = { ...current[0], id: "raw-copy", boundElements: null };
    const { elements } = await applyOps(current, [{ action: "add", elements: [extra] }]);
    expect(elements.some((el) => el.id === "raw-copy")).toBe(true);
  });
});

describe("applyOps: update", () => {
  it("patches a field on an existing element by id", async () => {
    const { elements: current } = await makeTwoBoxScene();
    const { elements } = await applyOps(current, [
      { action: "update", id: "a", patch: { backgroundColor: "#ffc9c9" } },
    ]);
    const boxA = elements.find((el) => el.id === "a")!;
    expect(boxA.backgroundColor).toBe("#ffc9c9");
  });

  it("ignores attempts to change id/type via patch", async () => {
    const { elements: current } = await makeTwoBoxScene();
    const { elements } = await applyOps(current, [
      { action: "update", id: "a", patch: { id: "hijacked", type: "ellipse", backgroundColor: "#fff" } },
    ]);
    expect(elements.some((el) => el.id === "hijacked")).toBe(false);
    const boxA = elements.find((el) => el.id === "a")!;
    expect(boxA.type).toBe("rectangle");
    expect(boxA.backgroundColor).toBe("#fff");
  });

  it("throws OpsError when the target id doesn't exist", async () => {
    const { elements: current } = await makeTwoBoxScene();
    await expect(applyOps(current, [{ action: "update", id: "nope", patch: {} }])).rejects.toBeInstanceOf(OpsError);
  });
});

describe("applyOps: delete", () => {
  it("removes the element and cascades to its bound text child", async () => {
    const { elements: current } = await makeTwoBoxScene();
    const boxA = current.find((el) => el.id === "a")!;
    const textId = boxA.boundElements!.find((bound) => bound.type === "text")!.id;

    const { elements } = await applyOps(current, [{ action: "delete", ids: ["a"] }]);
    expect(elements.some((el) => el.id === "a")).toBe(false);
    expect(elements.some((el) => el.id === textId)).toBe(false);
    expect(elements.some((el) => el.id === "b")).toBe(true);
  });

  it("throws OpsError for an unknown id", async () => {
    const { elements: current } = await makeTwoBoxScene();
    await expect(applyOps(current, [{ action: "delete", ids: ["nope"] }])).rejects.toBeInstanceOf(OpsError);
  });

  it("cleans up a surviving arrow's dangling binding after its target is deleted", async () => {
    const { elements: withArrow } = await applyOps((await makeTwoBoxScene()).elements, [
      {
        action: "add",
        skeleton: [{ type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } } as ExcalidrawElementSkeleton],
      },
    ]);
    const arrowId = withArrow.find((el) => el.type === "arrow")!.id;

    const { elements } = await applyOps(withArrow, [{ action: "delete", ids: ["b"] }]);
    const arrow = elements.find((el) => el.id === arrowId);
    expect(arrow).toBeDefined();
    if (arrow?.type === "arrow" || arrow?.type === "line") {
      expect(arrow.endBinding).toBeNull();
    }
    const { errors } = validateScene(elements);
    expect(errors).toEqual([]);
  });
});

describe("applyOps: replace_all", () => {
  it("discards the previous scene entirely", async () => {
    const { elements: current } = await makeTwoBoxScene();
    const { elements } = await applyOps(current, [
      {
        action: "replace_all",
        skeleton: [{ type: "ellipse", x: 0, y: 0, width: 50, height: 50, id: "only" } as ExcalidrawElementSkeleton],
      },
    ]);
    expect(elements.length).toBe(1);
    expect(elements[0]?.id).toBe("only");
  });

  it("rejects being combined with other ops", async () => {
    const { elements: current } = await makeTwoBoxScene();
    await expect(
      applyOps(current, [
        { action: "delete", ids: ["a"] },
        { action: "replace_all", elements: [] },
      ]),
    ).rejects.toBeInstanceOf(OpsError);
  });
});

describe("applyOps: op list validation", () => {
  it("rejects an empty op list", async () => {
    const { elements: current } = await makeTwoBoxScene();
    await expect(applyOps(current, [])).rejects.toBeInstanceOf(OpsError);
  });
});
