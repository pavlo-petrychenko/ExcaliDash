import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCacheForTests } from "../config.js";
import { normalizeSkeleton } from "../scene/normalize.js";
import type { ExcalidrawElementSkeleton } from "../scene/excalidrawVendor.js";
import { renderDrawing } from "./pipeline.js";
import { decodePngForTests, nonBackgroundPixelRatio } from "./pngTestSupport.test-util.js";

// `resolveImages` (render/images.ts, T6) defaults to the process-wide `getConfig()`
// singleton when the pipeline doesn't pass one explicitly — same as production, where
// index.ts validates EXCALIDASH_API_KEY before any tool runs. Stub it here so this
// unit test doesn't need a real key.
beforeEach(() => {
  vi.stubEnv("EXCALIDASH_API_KEY", "exd_test_test_test");
  resetConfigCacheForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCacheForTests();
});

const TWO_NODE_FLOW: ExcalidrawElementSkeleton[] = [
  { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "a", label: { text: "A" } } as ExcalidrawElementSkeleton,
  { type: "rectangle", x: 0, y: 200, width: 180, height: 80, id: "b", label: { text: "B" } } as ExcalidrawElementSkeleton,
  { type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } } as ExcalidrawElementSkeleton,
];

async function rawElements(): Promise<unknown[]> {
  const { elements } = await normalizeSkeleton(TWO_NODE_FLOW);
  // Round-trip through JSON, same as what `api/drawings.ts`'s `getDrawing()` hands back
  // (the backend stores/returns elements as a JSON string, parsed to plain objects).
  return JSON.parse(JSON.stringify(elements)) as unknown[];
}

describe("renderDrawing (render composition pipeline)", () => {
  it("renders a full-scene PNG from raw (JSON-round-tripped) elements", async () => {
    const result = await renderDrawing({
      elements: await rawElements(),
      files: {},
      appState: { viewBackgroundColor: "#ffffff" },
      mode: "full",
      maxLongSide: 1200,
      background: "white",
    });

    expect(result.png).toBeInstanceOf(Buffer);
    // 2 rectangles + their 2 bound label texts + 1 arrow.
    expect(result.elementCount).toBe(5);
    const decoded = decodePngForTests(result.png);
    expect(nonBackgroundPixelRatio(decoded)).toBeGreaterThan(0.01);
  });

  it("defaults the background color to white when appState is missing/empty", async () => {
    const result = await renderDrawing({
      elements: await rawElements(),
      files: null,
      appState: undefined,
      mode: "full",
      maxLongSide: 1200,
      background: "white",
    });
    expect(result.png.length).toBeGreaterThan(0);
  });

  it("mode:'elements' crops to a single node and pulls in its bound label (warnings empty)", async () => {
    const result = await renderDrawing({
      elements: await rawElements(),
      files: {},
      appState: {},
      mode: "elements",
      elementIds: ["a"],
      maxLongSide: 1200,
      background: "white",
    });
    // "a" + its bound label text + the arrow bound to it (via "a".boundElements) = 3.
    // "b" itself is not pulled in — an arrow's far endpoint isn't a bound partner
    // (crop.ts: bindings don't affect static drawing, only interactivity).
    expect(result.elementCount).toBe(3);
    expect(result.warnings).toEqual([]);
  });

  it("mode:'elements' with an unknown id produces a not-found warning instead of throwing", async () => {
    const result = await renderDrawing({
      elements: await rawElements(),
      files: {},
      appState: {},
      mode: "elements",
      elementIds: ["does-not-exist"],
      maxLongSide: 1200,
      background: "white",
    });
    expect(result.warnings.some((w) => w.includes("does-not-exist"))).toBe(true);
  });

  it("respects the maxLongSide clamp end-to-end", async () => {
    const result = await renderDrawing({
      elements: await rawElements(),
      files: {},
      appState: {},
      mode: "full",
      maxLongSide: 150,
      background: "white",
    });
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(150);
  });
});
