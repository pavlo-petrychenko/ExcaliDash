import { describe, it, expect } from "vitest";
import { getExcalidrawCore } from "./scene/excalidrawVendor.js";

describe("probe", () => {
  // NOTE: `@excalidraw/excalidraw@0.18.1` can't be imported directly under plain
  // Node (extensionless `roughjs` subpath, JSON-as-CJS-main, browser globals —
  // see `scripts/build-vendor.mjs` and `scene/excalidrawVendor.ts` for the full
  // explanation). Every consumer goes through `getExcalidrawCore()` instead.
  it("loads the bundled excalidraw core", async () => {
    const core = await getExcalidrawCore();
    expect(typeof core.convertToExcalidrawElements).toBe("function");
    expect(typeof core.restoreElements).toBe("function");
  });
});
