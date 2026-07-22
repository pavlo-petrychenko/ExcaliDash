import { describe, expect, it } from "vitest";
import { RenderEngineError, resetRenderBackendsForTests, selectRenderBackend } from "./engine.js";

describe("selectRenderBackend", () => {
  it("defaults to the resvg backend", () => {
    resetRenderBackendsForTests();
    const backend = selectRenderBackend("resvg");
    expect(backend).toBeDefined();
    expect(typeof backend.render).toBe("function");
  });

  it("returns a singleton per engine across calls", () => {
    resetRenderBackendsForTests();
    const first = selectRenderBackend("resvg");
    const second = selectRenderBackend("resvg");
    expect(second).toBe(first);
  });

  it("returns a distinct singleton for the browser engine", () => {
    resetRenderBackendsForTests();
    const resvg = selectRenderBackend("resvg");
    const browser = selectRenderBackend("browser");
    expect(browser).not.toBe(resvg);
  });

  it("browser engine's render() fails with an actionable message when playwright is not installed", async () => {
    resetRenderBackendsForTests();
    const backend = selectRenderBackend("browser");
    await expect(
      backend.render({
        elements: [],
        files: {},
        appState: { viewBackgroundColor: "#ffffff", exportBackground: true },
        maxLongSide: 1200,
        background: "white",
      }),
    ).rejects.toThrow(RenderEngineError);

    try {
      await backend.render({
        elements: [],
        files: {},
        appState: { viewBackgroundColor: "#ffffff", exportBackground: true },
        maxLongSide: 1200,
        background: "white",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderEngineError);
      const message = (error as Error).message;
      expect(message).toContain("playwright");
      expect(message).toContain("EXCALIDASH_RENDER_ENGINE");
      expect(message).toContain("npm install playwright");
    }
  });
});
