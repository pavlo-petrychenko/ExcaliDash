/**
 * Shared end-to-end test harness for `tools/*.test.ts`: spins up a real
 * `createServer()` wired to an in-memory MCP transport (exactly like
 * `server.test.ts`), with `global.fetch` stubbed to simulate the ExcaliDash
 * backend. Each tool test exercises its handler exactly as it runs in
 * production — real zod validation, real `runTool`/`createApiClient` wiring —
 * rather than reaching into a tool file's unexported internals.
 *
 * Named `*.test-util.ts` (not `*.test.ts`) so vitest's `include` glob doesn't
 * try to run it as its own suite (same convention as `pngTestSupport.test-util.ts`).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { vi } from "vitest";
import { resetConfigCacheForTests } from "../config.js";
import { createServer } from "../server.js";

export interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

export interface Harness {
  client: Client;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export type FakeBackendResponder = (request: RecordedRequest) => { status: number; body?: unknown } | Response;

/** Stubs `EXCALIDASH_API_KEY`/`fetch`, connects a fresh MCP client+server pair over an in-memory transport. */
export async function startHarness(respond: FakeBackendResponder): Promise<Harness> {
  vi.stubEnv("EXCALIDASH_API_KEY", "exd_test_test_test");
  vi.stubEnv("EXCALIDASH_BASE_URL", "https://excalidraw.pavlop.dev");
  resetConfigCacheForTests();

  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const request: RecordedRequest = { method: init?.method ?? "GET", url, body };
      requests.push(request);
      const outcome = respond(request);
      if (outcome instanceof Response) return outcome;
      return new Response(outcome.body === undefined ? "" : JSON.stringify(outcome.body), {
        status: outcome.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    requests,
    async close() {
      await client.close();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      resetConfigCacheForTests();
    },
  };
}

/** Convenience: a responder keyed by `"METHOD /path"` (path is everything after `/api`), 404 for anything unmapped. */
export function routedResponder(routes: Record<string, (request: RecordedRequest) => { status: number; body?: unknown }>): FakeBackendResponder {
  return (request) => {
    const path = new URL(request.url).pathname.replace(/^\/api/, "");
    const key = `${request.method} ${path}`;
    const handler = routes[key];
    if (!handler) {
      return { status: 404, body: { message: `no fake route for ${key}` } };
    }
    return handler(request);
  };
}
