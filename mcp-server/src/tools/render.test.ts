import { afterEach, describe, expect, it } from "vitest";
import { normalizeSkeleton } from "../scene/normalize.js";
import type { ExcalidrawElementSkeleton } from "../scene/excalidrawVendor.js";
import { routedResponder, startHarness, type Harness } from "./testHarness.test-util.js";

async function twoNodeElements(): Promise<unknown[]> {
  const skeleton: ExcalidrawElementSkeleton[] = [
    { type: "rectangle", x: 0, y: 0, width: 180, height: 80, id: "a", label: { text: "A" } } as ExcalidrawElementSkeleton,
    { type: "rectangle", x: 0, y: 200, width: 180, height: 80, id: "b", label: { text: "B" } } as ExcalidrawElementSkeleton,
  ];
  const { elements } = await normalizeSkeleton(skeleton);
  return JSON.parse(JSON.stringify(elements)) as unknown[];
}

function drawingResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d1",
    name: "Flow",
    collectionId: null,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
    ...overrides,
  };
}

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("excalidash_render", () => {
  it("renders mode:'region' when region arrived JSON-encoded as a string (agent SDKs sometimes stringify nested tool args)", async () => {
    const elements = await twoNodeElements();
    harness = await startHarness(routedResponder({ "GET /drawings/d1": () => ({ status: 200, body: drawingResponse({ elements, version: 1 }) }) }));

    const result = await harness.client.callTool({
      name: "excalidash_render",
      arguments: {
        drawing_id: "d1",
        mode: "region",
        // The bug: `region` arrives stringified instead of a genuine object.
        region: JSON.stringify({ x: 0, y: 0, width: 200, height: 100 }),
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; mimeType?: string }>;
    expect(content.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(true);
  });

  it("renders mode:'elements' when element_ids arrived JSON-encoded as a string", async () => {
    const elements = await twoNodeElements();
    harness = await startHarness(routedResponder({ "GET /drawings/d1": () => ({ status: 200, body: drawingResponse({ elements, version: 1 }) }) }));

    const result = await harness.client.callTool({
      name: "excalidash_render",
      arguments: { drawing_id: "d1", mode: "elements", element_ids: JSON.stringify(["a"]) },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; mimeType?: string }>;
    expect(content.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(true);
  });

  it("fails with an actionable message when region is a string that isn't valid JSON, instead of a generic zod error", async () => {
    harness = await startHarness(routedResponder({}));
    const result = await harness.client.callTool({
      name: "excalidash_render",
      arguments: { drawing_id: "d1", mode: "region", region: "{not valid json" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toMatch(/region arrived as a string that is not valid JSON/i);
    expect(harness.requests).toHaveLength(0);
  });
});
