import { afterEach, describe, expect, it } from "vitest";
import { normalizeSkeleton } from "../scene/normalize.js";
import type { ExcalidrawElementSkeleton } from "../scene/excalidrawVendor.js";
import { routedResponder, startHarness, type Harness, type RecordedRequest } from "./testHarness.test-util.js";

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

describe("excalidash_edit_diagram", () => {
  it("adds a node via ops, PUTs the full new array + current version, and returns an image by default", async () => {
    const elements = await twoNodeElements();
    let putBody: Record<string, unknown> | undefined;
    harness = await startHarness(
      routedResponder({
        "GET /drawings/d1": () => ({ status: 200, body: drawingResponse({ elements, version: 4 }) }),
        "PUT /drawings/d1": (request) => {
          putBody = request.body as Record<string, unknown>;
          return { status: 200, body: drawingResponse({ elements: putBody.elements, version: 5 }) };
        },
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: {
        drawing_id: "d1",
        ops: [{ action: "add", skeleton: [{ type: "rectangle", x: 400, y: 0, width: 180, height: 80, id: "c" }] }],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(putBody?.version).toBe(4);
    expect((putBody?.elements as unknown[]).length).toBeGreaterThan(elements.length);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content.some((b) => b.type === "image")).toBe(true);
    expect(content.some((b) => b.text?.includes("version 5"))).toBe(true);
  });

  it("applies ops that arrived JSON-encoded as a string (agent SDKs sometimes stringify nested tool args)", async () => {
    const elements = await twoNodeElements();
    let putBody: Record<string, unknown> | undefined;
    harness = await startHarness(
      routedResponder({
        "GET /drawings/d1": () => ({ status: 200, body: drawingResponse({ elements, version: 4 }) }),
        "PUT /drawings/d1": (request) => {
          putBody = request.body as Record<string, unknown>;
          return { status: 200, body: drawingResponse({ elements: putBody.elements, version: 5 }) };
        },
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: {
        drawing_id: "d1",
        // The bug: the whole `ops` array arrives stringified instead of a genuine array.
        ops: JSON.stringify([{ action: "add", skeleton: [{ type: "rectangle", x: 400, y: 0, width: 180, height: 80, id: "c" }] }]),
        render: false,
      },
    });

    expect(result.isError).toBeFalsy();
    expect((putBody?.elements as unknown[]).length).toBeGreaterThan(elements.length);
  });

  it("applies an ops array whose 'add' op carries a stringified spec (nested field stringified, outer array real)", async () => {
    const elements = await twoNodeElements();
    let putBody: Record<string, unknown> | undefined;
    harness = await startHarness(
      routedResponder({
        "GET /drawings/d1": () => ({ status: 200, body: drawingResponse({ elements, version: 4 }) }),
        "PUT /drawings/d1": (request) => {
          putBody = request.body as Record<string, unknown>;
          return { status: 200, body: drawingResponse({ elements: putBody.elements, version: 5 }) };
        },
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: {
        drawing_id: "d1",
        ops: [{ action: "add", spec: JSON.stringify({ nodes: [{ id: "c", label: "C" }] }) }],
        render: false,
      },
    });

    expect(result.isError).toBeFalsy();
    expect((putBody?.elements as unknown[]).length).toBeGreaterThan(elements.length);
  });

  it("fails with an actionable message when ops is a string that isn't valid JSON, instead of a generic zod error", async () => {
    harness = await startHarness(routedResponder({}));
    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: { drawing_id: "d1", ops: "{not valid json" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toMatch(/ops arrived as a string that is not valid JSON/i);
    expect(harness.requests).toHaveLength(0);
  });

  it("re-applies the same ops onto a fresh base and retries exactly once on a 409", async () => {
    const elementsV4 = await twoNodeElements();
    let getCount = 0;
    let putCount = 0;
    const putBodies: Array<Record<string, unknown>> = [];
    harness = await startHarness(
      routedResponder({
        "GET /drawings/d1": () => {
          getCount += 1;
          return { status: 200, body: drawingResponse({ elements: elementsV4, version: getCount === 1 ? 4 : 9 }) };
        },
        "PUT /drawings/d1": (request) => {
          putCount += 1;
          putBodies.push(request.body as Record<string, unknown>);
          if (putCount === 1) {
            return { status: 409, body: { message: "Drawing has changed", code: "VERSION_CONFLICT", currentVersion: 9 } };
          }
          return { status: 200, body: drawingResponse({ elements: (request.body as { elements: unknown[] }).elements, version: 10 }) };
        },
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: { drawing_id: "d1", ops: [{ action: "delete", ids: ["b"] }], render: false },
    });

    expect(result.isError).toBeFalsy();
    expect(putBodies).toHaveLength(2);
    expect(putBodies[0]?.version).toBe(4);
    expect(putBodies[1]?.version).toBe(9);
    // Both attempts applied the SAME declarative delete op: "b" is gone from both PUT bodies.
    for (const body of putBodies) {
      const ids = (body.elements as Array<{ id: string }>).map((el) => el.id);
      expect(ids).not.toContain("b");
    }
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toContain("re-applied once");
  });

  it("aborts without a PUT when expected_version doesn't match the fetched version", async () => {
    const elements = await twoNodeElements();
    harness = await startHarness(
      routedResponder({
        "GET /drawings/d1": () => ({ status: 200, body: drawingResponse({ elements, version: 7 }) }),
        "PUT /drawings/d1": () => ({ status: 200, body: drawingResponse({ version: 8 }) }),
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: { drawing_id: "d1", expected_version: 3, ops: [{ action: "delete", ids: ["a"] }] },
    });

    expect(result.isError).toBe(true);
    expect(harness.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("duplicates the drawing first when snapshot_first is set", async () => {
    const elements = await twoNodeElements();
    harness = await startHarness(
      routedResponder({
        "POST /drawings/d1/duplicate": () => ({ status: 201, body: drawingResponse({ id: "snap1", version: 1 }) }),
        "GET /drawings/d1": () => ({ status: 200, body: drawingResponse({ elements, version: 1 }) }),
        "PUT /drawings/d1": (request) => ({ status: 200, body: drawingResponse({ elements: (request.body as { elements: unknown[] }).elements, version: 2 }) }),
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: { drawing_id: "d1", snapshot_first: true, ops: [{ action: "delete", ids: ["a"] }], render: false },
    });

    expect(result.isError).toBeFalsy();
    expect(harness.requests.some((r) => r.url.endsWith("/drawings/d1/duplicate"))).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toContain("snap1");
  });

  it("relayout:true rejects a scene with unsupported element types with an actionable error, not a 500", async () => {
    harness = await startHarness(
      routedResponder({
        "GET /drawings/d1": () => ({
          status: 200,
          body: drawingResponse({
            // A minimally-fielded freedraw element would be silently dropped by
            // `restoreElements` (it isn't structurally valid), which would make
            // the `update` op below fail with a "no element with id" error
            // instead of ever reaching relayout's own type check. Give it every
            // field `restoreElements` requires to survive, so this test
            // actually exercises `assertFullySupported`'s rejection.
            elements: [
              {
                type: "freedraw",
                id: "f1",
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                points: [
                  [0, 0],
                  [10, 10],
                ],
                pressures: [],
                simulatePressure: true,
                lastCommittedPoint: null,
                strokeColor: "#1e1e1e",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                angle: 0,
              },
            ],
            version: 1,
          }),
        }),
      }),
    );

    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: { drawing_id: "d1", relayout: true, ops: [{ action: "update", id: "f1", patch: {} }] },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toMatch(/relayout/i);
  });

  it("surfaces a 404 as an actionable error", async () => {
    harness = await startHarness(routedResponder({ "GET /drawings/d1": () => ({ status: 404, body: {} }) }));
    const result = await harness.client.callTool({
      name: "excalidash_edit_diagram",
      arguments: { drawing_id: "d1", ops: [{ action: "delete", ids: ["a"] }] },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toMatch(/list_drawings/i);
  });
});

// Silence unused-import lint for RecordedRequest re-export path used only for typing in other files.
export type { RecordedRequest };
