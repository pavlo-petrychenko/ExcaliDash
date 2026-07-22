import { describe, expect, it } from "vitest";
import { normalizeSkeleton } from "../scene/normalize.js";
import type { ExcalidrawElementSkeleton } from "../scene/excalidrawVendor.js";
import { createResvgBackend } from "./resvg.js";
import type { RenderInput } from "./engine.js";
import { decodePngForTests, nonBackgroundPixelRatio } from "./pngTestSupport.test-util.js";

const THREE_NODE_FLOW: ExcalidrawElementSkeleton[] = [
  { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "start", roundness: { type: 3 }, backgroundColor: "#b2f2bb", label: { text: "Start" } } as ExcalidrawElementSkeleton,
  { type: "rectangle", x: 0, y: 180, width: 180, height: 80, id: "process", roundness: { type: 3 }, backgroundColor: "#a5d8ff", label: { text: "Process" } } as ExcalidrawElementSkeleton,
  { type: "rectangle", x: 0, y: 360, width: 180, height: 80, id: "end", roundness: { type: 3 }, backgroundColor: "#ffc9c9", label: { text: "End" } } as ExcalidrawElementSkeleton,
  { type: "arrow", x: 0, y: 0, start: { id: "start" }, end: { id: "process" } } as ExcalidrawElementSkeleton,
  { type: "arrow", x: 0, y: 0, start: { id: "process" }, end: { id: "end" } } as ExcalidrawElementSkeleton,
];

const TWO_NODE_VERTICAL_FLOW: ExcalidrawElementSkeleton[] = [
  { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "top", roundness: { type: 3 }, backgroundColor: "#b2f2bb", label: { text: "Top" } } as ExcalidrawElementSkeleton,
  { type: "rectangle", x: 0, y: 300, width: 180, height: 80, id: "bottom", roundness: { type: 3 }, backgroundColor: "#a5d8ff", label: { text: "Bottom" } } as ExcalidrawElementSkeleton,
  { type: "arrow", x: 0, y: 0, start: { id: "top" }, end: { id: "bottom" } } as ExcalidrawElementSkeleton,
];

function baseAppState(): RenderInput["appState"] {
  return { viewBackgroundColor: "#ffffff", exportBackground: true };
}

describe("resvg render backend: 3-node flow (T6 golden path)", () => {
  it("renders a decodable, non-blank PNG within the max_width clamp", async () => {
    const { elements } = await normalizeSkeleton(THREE_NODE_FLOW);
    const backend = createResvgBackend();

    const result = await backend.render({
      elements,
      files: {},
      appState: baseAppState(),
      maxLongSide: 1200,
      background: "white",
    });

    expect(result.png).toBeInstanceOf(Buffer);
    expect(result.png.length).toBeGreaterThan(0);

    const decoded = decodePngForTests(result.png);
    expect(decoded.width).toBe(result.width);
    expect(decoded.height).toBe(result.height);
    expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(1200);

    // Shapes + labels must leave visible ink — a blank/failed render would be ~0.
    expect(nonBackgroundPixelRatio(decoded)).toBeGreaterThan(0.02);
  });

  it("respects a tight max_width clamp", async () => {
    const { elements } = await normalizeSkeleton(THREE_NODE_FLOW);
    const backend = createResvgBackend();

    const result = await backend.render({
      elements,
      files: {},
      appState: baseAppState(),
      maxLongSide: 150,
      background: "white",
    });

    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(150);
    const decoded = decodePngForTests(result.png);
    expect(decoded.width).toBe(result.width);
    expect(decoded.height).toBe(result.height);
  });

  it("produces meaningfully more ink for a labeled scene than for an empty one (proxy for real glyph rendering)", async () => {
    const backend = createResvgBackend();
    const { elements: labeled } = await normalizeSkeleton(THREE_NODE_FLOW);

    const labeledResult = await backend.render({
      elements: labeled,
      files: {},
      appState: baseAppState(),
      maxLongSide: 1200,
      background: "white",
    });
    const emptyResult = await backend.render({
      elements: [],
      files: {},
      appState: baseAppState(),
      maxLongSide: 1200,
      background: "white",
    });

    const labeledInk = nonBackgroundPixelRatio(decodePngForTests(labeledResult.png));
    const emptyInk = nonBackgroundPixelRatio(decodePngForTests(emptyResult.png));
    expect(labeledInk).toBeGreaterThan(emptyInk);
  });

  it("keeps svg output attached to the result", async () => {
    const { elements } = await normalizeSkeleton(THREE_NODE_FLOW);
    const backend = createResvgBackend();
    const result = await backend.render({
      elements,
      files: {},
      appState: baseAppState(),
      maxLongSide: 1200,
      background: "transparent",
    });
    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("Excalifont");
  });
});

describe("resvg render backend: 2-node vertical flow (regression — arrows must connect, not pile up at the origin)", () => {
  it("draws visible ink in the corridor strip between the two nodes' bounding boxes", async () => {
    const { elements } = await normalizeSkeleton(TWO_NODE_VERTICAL_FLOW);
    const backend = createResvgBackend();

    const result = await backend.render({
      elements,
      files: {},
      appState: baseAppState(),
      maxLongSide: 1200,
      background: "white",
    });
    const decoded = decodePngForTests(result.png);

    // Scene bounds (unscaled): two 180x80 nodes at y:0 and y:300 leave a 220-unit corridor
    // (scene y 80..300) between them where nothing but the connecting arrow should ever draw
    // ink. `exportToSvg` adds symmetric padding around the scene bounds before rasterizing;
    // derive it from the actual rendered height instead of hardcoding the backend's padding
    // constant (scale is 1 here since the scene is far smaller than maxLongSide).
    const sceneHeight = 380; // bottom node's y (300) + its height (80)
    const paddingY = (result.height - sceneHeight) / 2;
    const margin = 4;
    const stripTop = Math.round(paddingY + 80 + margin);
    const stripBottom = Math.round(paddingY + 300 - margin);
    expect(stripBottom).toBeGreaterThan(stripTop);

    let inkInCorridor = 0;
    for (let y = stripTop; y < stripBottom; y++) {
      for (let x = 0; x < decoded.width; x++) {
        const offset = (y * decoded.width + x) * decoded.bytesPerPixel;
        const r = decoded.pixels[offset];
        const g = decoded.bytesPerPixel > 1 ? decoded.pixels[offset + 1] : r;
        const b = decoded.bytesPerPixel > 2 ? decoded.pixels[offset + 2] : r;
        if (Math.abs(r - 255) + Math.abs(g - 255) + Math.abs(b - 255) > 30) inkInCorridor++;
      }
    }

    // Before the fix, the arrow stayed pinned at the scene origin, so this corridor (well below
    // the top node and well above the bottom one) would be entirely blank.
    expect(inkInCorridor).toBeGreaterThan(0);
  });
});
