import { describe, expect, it, vi } from "vitest";
import type { ApiClient, HttpMethod } from "./client.js";
import {
  createDrawing,
  deleteDrawing,
  type DrawingRecord,
  duplicateDrawing,
  getDrawing,
  getDrawingSnapshot,
  listDrawingHistory,
  listDrawings,
  listSharedDrawings,
  restoreDrawingSnapshot,
  updateDrawing,
  updateDrawingWithVersionRetry,
} from "./drawings.js";
import { ApiError } from "./errors.js";

interface RecordedCall {
  method: HttpMethod;
  path: string;
  options?: { query?: Record<string, unknown>; body?: unknown };
}

function fakeClient(responder: (call: RecordedCall) => unknown): {
  client: ApiClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client: ApiClient = {
    async request(method, path, options) {
      const call = { method, path, options };
      calls.push(call);
      return responder(call) as never;
    },
  };
  return { client, calls };
}

function drawing(overrides: Partial<DrawingRecord> = {}): DrawingRecord {
  return {
    id: "d1",
    name: "Untitled",
    collectionId: null,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    elements: [],
    appState: {},
    files: {},
    ...overrides,
  };
}

describe("drawings — typed calls", () => {
  it("listDrawings calls GET /drawings with the given query", async () => {
    const { client, calls } = fakeClient(() => ({ drawings: [], totalCount: 0, limit: 20, offset: 0 }));
    await listDrawings(client, { search: "flow", limit: 20 });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/drawings" });
    expect(calls[0].options?.query).toMatchObject({ search: "flow", limit: 20 });
  });

  it("listSharedDrawings calls GET /drawings/shared", async () => {
    const { client, calls } = fakeClient(() => ({ drawings: [], totalCount: 0, limit: null, offset: 0 }));
    await listSharedDrawings(client);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/drawings/shared" });
  });

  it("getDrawing calls GET /drawings/:id with the id URL-encoded", async () => {
    const { client, calls } = fakeClient(() => drawing());
    await getDrawing(client, "id with space");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/drawings/id%20with%20space" });
  });

  it("createDrawing calls POST /drawings with the input as body", async () => {
    const { client, calls } = fakeClient(() => drawing());
    await createDrawing(client, { name: "New" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/drawings" });
    expect(calls[0].options?.body).toEqual({ name: "New" });
  });

  it("updateDrawing calls PUT /drawings/:id with the input as body", async () => {
    const { client, calls } = fakeClient(() => drawing({ version: 2 }));
    await updateDrawing(client, "d1", { name: "Renamed", version: 1 });
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/drawings/d1" });
    expect(calls[0].options?.body).toEqual({ name: "Renamed", version: 1 });
  });

  it("deleteDrawing calls DELETE /drawings/:id", async () => {
    const { client, calls } = fakeClient(() => undefined);
    await deleteDrawing(client, "d1");
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/drawings/d1" });
  });

  it("duplicateDrawing calls POST /drawings/:id/duplicate", async () => {
    const { client, calls } = fakeClient(() => drawing({ id: "d2" }));
    await duplicateDrawing(client, "d1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/drawings/d1/duplicate" });
  });

  it("listDrawingHistory calls GET /drawings/:id/history with limit/offset", async () => {
    const { client, calls } = fakeClient(() => ({ snapshots: [], totalCount: 0 }));
    await listDrawingHistory(client, "d1", { limit: 5, offset: 10 });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/drawings/d1/history" });
    expect(calls[0].options?.query).toEqual({ limit: 5, offset: 10 });
  });

  it("getDrawingSnapshot calls GET /drawings/:id/history/:snapshotId", async () => {
    const { client, calls } = fakeClient(() => ({
      id: "s1",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      elements: [],
      appState: {},
      files: {},
    }));
    await getDrawingSnapshot(client, "d1", "s1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/drawings/d1/history/s1" });
  });

  it("restoreDrawingSnapshot calls POST /drawings/:id/history/:snapshotId/restore", async () => {
    const { client, calls } = fakeClient(() => drawing({ version: 3 }));
    await restoreDrawingSnapshot(client, "d1", "s1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/drawings/d1/history/s1/restore",
    });
  });
});

describe("updateDrawingWithVersionRetry", () => {
  it("GETs current, PUTs once, and does not retry on success", async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.method === "GET") return drawing({ version: 4 });
      return drawing({ version: 5 });
    });

    const result = await updateDrawingWithVersionRetry(client, "d1", (current) => ({
      elements: [{ id: "n1" }],
      version: current.version,
    }));

    expect(result.retried).toBe(false);
    expect(result.drawing.version).toBe(5);
    expect(calls).toHaveLength(2);
    expect(calls[1].options?.body).toMatchObject({ version: 4 });
  });

  it("re-reads and retries exactly once on a 409, then succeeds", async () => {
    let putCount = 0;
    const { client, calls } = fakeClient((call) => {
      if (call.method === "GET") {
        return drawing({ version: putCount === 0 ? 4 : 9 });
      }
      putCount += 1;
      if (putCount === 1) {
        throw new ApiError("conflict", "Drawing changed concurrently — re-read and retry.", {
          status: 409,
          currentVersion: 9,
        });
      }
      return drawing({ version: 10 });
    });

    const result = await updateDrawingWithVersionRetry(client, "d1", (current) => ({
      elements: [{ id: "n1" }],
      version: current.version,
    }));

    expect(result.retried).toBe(true);
    expect(result.drawing.version).toBe(10);
    // GET, PUT (409), GET, PUT (success)
    expect(calls).toHaveLength(4);
    expect(calls[3].options?.body).toMatchObject({ version: 9 });
  });

  it("propagates the ApiError when the retried PUT also conflicts", async () => {
    const { client } = fakeClient((call) => {
      if (call.method === "GET") return drawing({ version: 4 });
      throw new ApiError("conflict", "Drawing changed concurrently — re-read and retry.", {
        status: 409,
        currentVersion: 99,
      });
    });

    await expect(
      updateDrawingWithVersionRetry(client, "d1", (current) => ({
        elements: [{ id: "n1" }],
        version: current.version,
      })),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("propagates non-conflict errors from the first PUT without retrying", async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.method === "GET") return drawing({ version: 4 });
      throw new ApiError("forbidden", "API key lacks the required scope.", { status: 403 });
    });

    await expect(
      updateDrawingWithVersionRetry(client, "d1", (current) => ({
        elements: [{ id: "n1" }],
        version: current.version,
      })),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(calls).toHaveLength(2);
  });

  it("supports an async buildUpdate (edit_diagram's declarative-ops pipeline is async)", async () => {
    const { client } = fakeClient((call) => {
      if (call.method === "GET") return drawing({ version: 7 });
      return drawing({ version: 8 });
    });

    const result = await updateDrawingWithVersionRetry(client, "d1", async (current) => {
      await Promise.resolve();
      return { elements: [{ id: "n1" }], version: current.version };
    });

    expect(result.retried).toBe(false);
    expect(result.drawing.version).toBe(8);
  });

  it("propagates a synchronous throw from buildUpdate (e.g. an expected_version mismatch check)", async () => {
    const { client, calls } = fakeClient(() => drawing({ version: 7 }));

    await expect(
      updateDrawingWithVersionRetry(client, "d1", () => {
        throw new ApiError("conflict", "stale expected_version", { status: 409, currentVersion: 7 });
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
    // GET, then buildUpdate throws before any PUT is attempted for the retry either
    // (the retry's own buildUpdate call throws again, uncaught by a second catch).
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });
});
