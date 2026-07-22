import { describe, expect, it } from "vitest";
import type { ApiClient, HttpMethod } from "./client.js";
import {
  type CollectionRecord,
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
} from "./collections.js";

interface RecordedCall {
  method: HttpMethod;
  path: string;
  options?: { body?: unknown };
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

function collection(overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return { id: "c1", name: "Flowcharts", createdAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

describe("collections — typed calls", () => {
  it("listCollections calls GET /collections", async () => {
    const { client, calls } = fakeClient(() => [collection()]);
    const result = await listCollections(client);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/collections" });
    expect(result).toEqual([collection()]);
  });

  it("createCollection calls POST /collections with { name }", async () => {
    const { client, calls } = fakeClient(() => collection({ name: "Diagrams" }));
    await createCollection(client, "Diagrams");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/collections" });
    expect(calls[0].options?.body).toEqual({ name: "Diagrams" });
  });

  it("renameCollection calls PUT /collections/:id with { name }", async () => {
    const { client, calls } = fakeClient(() => collection({ name: "Renamed" }));
    await renameCollection(client, "c1", "Renamed");
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/collections/c1" });
    expect(calls[0].options?.body).toEqual({ name: "Renamed" });
  });

  it("deleteCollection calls DELETE /collections/:id", async () => {
    const { client, calls } = fakeClient(() => undefined);
    await deleteCollection(client, "c1");
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/collections/c1" });
  });
});
