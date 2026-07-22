import { describe, expect, it } from "vitest";
import { MAX_ELEMENTS } from "../constants.js";
import { normalizeElements, normalizeSkeleton, SceneValidationError, validateScene } from "./normalize.js";
import type { ExcalidrawElementSkeleton, OrderedExcalidrawElement } from "./excalidrawVendor.js";

const TWO_BOX_ARROW_SKELETON: ExcalidrawElementSkeleton[] = [
  {
    type: "rectangle",
    x: 0,
    y: 0,
    width: 180,
    height: 80,
    id: "box-a",
    label: { text: "Client" },
  } as ExcalidrawElementSkeleton,
  {
    type: "rectangle",
    x: 400,
    y: 0,
    width: 180,
    height: 80,
    id: "box-b",
    label: { text: "Server" },
  } as ExcalidrawElementSkeleton,
  {
    type: "arrow",
    x: 0,
    y: 0,
    start: { id: "box-a" },
    end: { id: "box-b" },
    label: { text: "HTTP" },
  } as ExcalidrawElementSkeleton,
];

describe("normalizeSkeleton (convert path)", () => {
  it("produces elements with non-null fractional indices", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW_SKELETON);
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) {
      expect(element.index).not.toBeNull();
    }
  });

  it("wires reciprocal bindings: containers <-> bound text, arrow <-> shapes", async () => {
    const { elements } = await normalizeSkeleton(TWO_BOX_ARROW_SKELETON);
    const byId = new Map(elements.map((element) => [element.id, element]));

    const boxA = byId.get("box-a");
    const boxB = byId.get("box-b");
    const arrow = elements.find((element) => element.type === "arrow");
    expect(boxA).toBeDefined();
    expect(boxB).toBeDefined();
    expect(arrow).toBeDefined();

    // Container -> bound text reciprocity.
    const textOnBoxA = boxA!.boundElements!.find((bound) => bound.type === "text")!;
    const textElement = byId.get(textOnBoxA.id);
    expect(textElement).toBeDefined();
    expect(textElement!.type).toBe("text");
    expect((textElement as { containerId: string }).containerId).toBe("box-a");

    // Arrow -> shape reciprocity.
    if (arrow!.type === "arrow" || arrow!.type === "line") {
      expect(arrow!.startBinding?.elementId).toBe("box-a");
      expect(arrow!.endBinding?.elementId).toBe("box-b");
    }
    expect(boxA!.boundElements!.some((bound) => bound.type === "arrow" && bound.id === arrow!.id)).toBe(true);
    expect(boxB!.boundElements!.some((bound) => bound.type === "arrow" && bound.id === arrow!.id)).toBe(true);

    const { errors, warnings } = validateScene(elements);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("throws SceneValidationError with an actionable message when MAX_ELEMENTS is exceeded", async () => {
    const tooMany: ExcalidrawElementSkeleton[] = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => ({
      type: "rectangle",
      x: i * 10,
      y: 0,
      width: 5,
      height: 5,
      id: `r${i}`,
    })) as ExcalidrawElementSkeleton[];

    await expect(normalizeSkeleton(tooMany)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SceneValidationError);
      const validationError = error as SceneValidationError;
      expect(validationError.errors.some((message) => message.includes(String(MAX_ELEMENTS)))).toBe(true);
      expect(validationError.errors.some((message) => message.includes("Split into multiple drawings"))).toBe(true);
      return true;
    });
  });
});

describe("normalizeElements (raw elements path repairs a broken fixture)", () => {
  // Deliberately broken: rectangle's bound-text back-ref is missing seed/index,
  // and the container's boundElements array omits the text entirely.
  const brokenContainer = {
    id: "c1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 180,
    height: 80,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    groupIds: [],
    frameId: null,
    boundElements: null, // <- missing back-ref to the text below
    link: null,
    locked: false,
    isDeleted: false,
    index: null, // <- deliberately null
    // seed/versionNonce/version intentionally omitted entirely.
  };
  const brokenText = {
    id: "t1",
    type: "text",
    x: 10,
    y: 30,
    width: 100,
    height: 25,
    text: "Broken",
    originalText: "Broken",
    fontSize: 20,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: "c1", // <- points at c1, but c1 doesn't list it back
    lineHeight: 1.25,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    isDeleted: false,
    index: null,
  };

  it("backfills missing seed/index and repairs the container<->text back-reference", async () => {
    const { elements, warnings } = await normalizeElements([brokenContainer, brokenText]);
    expect(warnings).toBeDefined();

    const byId = new Map(elements.map((element) => [element.id, element]));
    const container = byId.get("c1")!;
    const text = byId.get("t1")!;

    expect(container.index).not.toBeNull();
    expect(text.index).not.toBeNull();
    expect((container as unknown as { seed: number }).seed).toEqual(expect.any(Number));

    expect(container.boundElements?.some((bound) => bound.type === "text" && bound.id === "t1")).toBe(true);

    const { errors } = validateScene(elements);
    expect(errors).toEqual([]);
  });
});

describe("validateScene", () => {
  function makeArrowReferencingMissingNode(): OrderedExcalidrawElement[] {
    const base = {
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid" as const,
      strokeWidth: 2,
      strokeStyle: "solid" as const,
      roughness: 1,
      opacity: 100,
      angle: 0,
      groupIds: [],
      frameId: null,
      boundElements: null,
      link: null,
      locked: false,
      isDeleted: false,
      index: "a0" as unknown as OrderedExcalidrawElement["index"],
      seed: 1,
      version: 1,
      versionNonce: 1,
      updated: Date.now(),
    };
    const arrow = {
      ...base,
      id: "arrow-1",
      type: "arrow",
      points: [
        [0, 0],
        [100, 0],
      ],
      lastCommittedPoint: null,
      startBinding: { elementId: "does-not-exist", focus: 0, gap: 5 },
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
    };
    return [arrow] as unknown as OrderedExcalidrawElement[];
  }

  it("reports an actionable error for an arrow bound to a missing node", () => {
    const { errors } = validateScene(makeArrowReferencingMissingNode());
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("arrow-1");
    expect(errors[0]).toContain("does-not-exist");
    expect(errors[0]).toContain("Valid node ids");
  });
});
