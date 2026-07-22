import { afterEach, describe, expect, it } from "vitest";
import { routedResponder, startHarness, type Harness, type RecordedRequest } from "./testHarness.test-util.js";

function drawingResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d1",
    name: "Untitled",
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

describe("excalidash_create_diagram", () => {
  it("creates from a spec, POSTs the normalized elements, and returns an image block by default", async () => {
    let posted: RecordedRequest | undefined;
    harness = await startHarness(
      routedResponder({
        "POST /drawings": (request) => {
          posted = request;
          const body = request.body as Record<string, unknown>;
          return { status: 201, body: drawingResponse({ elements: body.elements, appState: body.appState }) };
        },
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: { name: "Flow", spec: { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] } },
    });

    expect(result.isError).toBeFalsy();
    const body = posted!.body as { name: string; elements: unknown[] };
    expect(body.name).toBe("Flow");
    expect(Array.isArray(body.elements)).toBe(true);
    expect(body.elements.length).toBeGreaterThan(0);

    const content = result.content as Array<{ type: string; text?: string; mimeType?: string }>;
    expect(content.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(true);
    expect(content.some((block) => block.type === "text" && block.text?.includes("d1"))).toBe(true);
  });

  it("creates from a raw skeleton", async () => {
    harness = await startHarness(
      routedResponder({
        "POST /drawings": (request) => ({ status: 201, body: drawingResponse({ elements: (request.body as { elements: unknown[] }).elements }) }),
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: {
        name: "Manual",
        skeleton: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
        render: false,
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string }>;
    expect(content.every((block) => block.type === "text")).toBe(true);
  });

  it("creates from raw elements (escape hatch)", async () => {
    harness = await startHarness(
      routedResponder({
        "POST /drawings": () => ({ status: 201, body: drawingResponse() }),
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: {
        name: "Escape hatch",
        elements: [{ type: "rectangle", id: "r1", x: 0, y: 0, width: 10, height: 10 }],
        render: false,
      },
    });
    expect(result.isError).toBeFalsy();
  });

  it("render:false skips the image block entirely", async () => {
    harness = await startHarness(routedResponder({ "POST /drawings": () => ({ status: 201, body: drawingResponse() }) }));
    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: { name: "No render", spec: { nodes: [{ id: "a", label: "A" }] }, render: false },
    });
    const content = result.content as Array<{ type: string }>;
    expect(content.every((block) => block.type === "text")).toBe(true);
  });

  it("surfaces a 403 as an actionable isError:true result, not a crash", async () => {
    harness = await startHarness(
      routedResponder({ "POST /drawings": () => ({ status: 403, body: { message: "no scope" } }) }),
    );
    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: { name: "Flow", spec: { nodes: [{ id: "a", label: "A" }] } },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toMatch(/scope/i);
  });

  it("creates from a spec that arrived JSON-encoded as a string (agent SDKs sometimes stringify nested tool args)", async () => {
    let posted: RecordedRequest | undefined;
    harness = await startHarness(
      routedResponder({
        "POST /drawings": (request) => {
          posted = request;
          const body = request.body as Record<string, unknown>;
          return { status: 201, body: drawingResponse({ elements: body.elements, appState: body.appState }) };
        },
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: {
        name: "Flow",
        // The bug: a real agent stringifies this nested object instead of sending it as a genuine object.
        spec: JSON.stringify({ nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] }),
      },
    });

    expect(result.isError).toBeFalsy();
    const body = posted!.body as { elements: unknown[] };
    expect(Array.isArray(body.elements)).toBe(true);
    expect(body.elements.length).toBeGreaterThan(0);
    const content = result.content as Array<{ type: string; mimeType?: string }>;
    expect(content.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(true);
  });

  it("fails with an actionable message when spec is a string that isn't valid JSON, instead of a generic zod error", async () => {
    harness = await startHarness(routedResponder({}));
    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: { name: "Flow", spec: "{not valid json" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toMatch(/spec arrived as a string that is not valid JSON/i);
    expect(harness.requests).toHaveLength(0);
  });

  it("rejects the tool call before hitting the network when exactly-one-of is violated", async () => {
    harness = await startHarness(routedResponder({}));
    const result = await harness.client.callTool({
      name: "excalidash_create_diagram",
      arguments: { name: "Flow" },
    });
    expect(result.isError).toBe(true);
    expect(harness.requests).toHaveLength(0);
  });
});
