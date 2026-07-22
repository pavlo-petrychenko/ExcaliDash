import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../config.js";
import { createApiClient } from "./client.js";
import { ApiError } from "./errors.js";

const baseConfig: McpConfig = {
  apiKey: "exd_testkeyid_supersecretvalue",
  baseUrl: "https://excalidraw.pavlop.dev",
  renderEngine: "resvg",
  allowInsecure: false,
  requestTimeoutMs: 30_000,
  maxLongSide: 1200,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createApiClient — request shape", () => {
  it("sends Authorization: Bearer <apiKey> and Accept: application/json", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = createApiClient(baseConfig);
    await client.request("GET", "/drawings");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${baseConfig.apiKey}`);
    expect(headers.Accept).toBe("application/json");
  });

  it("builds the URL under /api and includes defined query params only", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = createApiClient(baseConfig);
    await client.request("GET", "/drawings", {
      query: { search: "flow", limit: 10, includeData: undefined },
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://excalidraw.pavlop.dev/api/drawings?search=flow&limit=10");
  });

  it("sends redirect: manual on every request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = createApiClient(baseConfig);
    await client.request("GET", "/drawings");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("JSON-encodes the body and sets Content-Type only when a body is present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "d1" }));
    const client = createApiClient(baseConfig);
    await client.request("POST", "/drawings", { body: { name: "Untitled" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBe(JSON.stringify({ name: "Untitled" }));
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("passes an AbortSignal derived from requestTimeoutMs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = createApiClient(baseConfig);
    await client.request("GET", "/drawings");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("createApiClient — https enforcement", () => {
  it("rejects an http:// baseUrl at construction when allowInsecure is false", () => {
    expect(() =>
      createApiClient({ ...baseConfig, baseUrl: "http://example.com", allowInsecure: false }),
    ).toThrow(ApiError);
  });

  it("allows an http:// baseUrl when allowInsecure is true", () => {
    expect(() =>
      createApiClient({ ...baseConfig, baseUrl: "http://localhost:8001", allowInsecure: true }),
    ).not.toThrow();
  });
});

describe("createApiClient — timeout", () => {
  it("aborts and throws a network ApiError with a timeout message when the request hangs", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const client = createApiClient({ ...baseConfig, requestTimeoutMs: 5 });
    await expect(client.request("GET", "/drawings")).rejects.toMatchObject({
      kind: "network",
      message: expect.stringContaining("Timed out"),
    });
  });
});

describe("createApiClient — redirects", () => {
  it("treats a 3xx response as an error instead of following it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "/login" } }));
    const client = createApiClient(baseConfig);
    await expect(client.request("GET", "/drawings")).rejects.toMatchObject({ kind: "network" });
  });
});

describe("createApiClient — error mapping", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [429, "rate_limited"],
    [500, "http"],
  ] as const)("maps HTTP %i to ApiError kind %s", async (status, kind) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, { message: "backend said no" }));
    const client = createApiClient(baseConfig);
    await expect(client.request("GET", "/drawings/does-not-exist")).rejects.toMatchObject({ kind });
  });

  it("throws a network ApiError when fetch itself rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = createApiClient(baseConfig);
    await expect(client.request("GET", "/drawings")).rejects.toMatchObject({ kind: "network" });
  });
});

describe("createApiClient — secret redaction", () => {
  it("never writes the raw API key to stderr, even when a request errors", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "nope" }));
    const client = createApiClient(baseConfig);

    await expect(client.request("GET", "/drawings/secret-drawing")).rejects.toThrow(ApiError);

    for (const call of stderrSpy.mock.calls) {
      const text = call.map((arg) => String(arg)).join(" ");
      expect(text).not.toContain(baseConfig.apiKey);
    }
  });

  it("never includes the raw API key in a thrown ApiError's message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "invalid" }));
    const client = createApiClient(baseConfig);
    try {
      await client.request("GET", "/drawings");
      expect.unreachable("request should have thrown");
    } catch (error) {
      expect((error as ApiError).message).not.toContain(baseConfig.apiKey);
    }
  });
});
