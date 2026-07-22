import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import type { BinaryFiles } from "../scene/excalidrawVendor.js";
import { isDisallowedIp, resolveImages } from "./images.js";

// Only the Cloudflare Access header tests below need a mocked DNS lookup (to reach a
// "public IP" without a real network call) — every other test in this file resolves
// via the real `node:dns/promises` against `localhost`, so the mock must fall through
// to the actual implementation by default.
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return { ...actual, lookup: vi.fn(actual.lookup) };
});

function file(dataURL: string): BinaryFiles[string] {
  return { id: "f1" as never, mimeType: "image/png" as never, dataURL: dataURL as never, created: 0 };
}

// `localhost` always resolves locally (127.0.0.1/::1) without any real network
// call — using it as the configured backend origin lets these tests exercise
// "host matches, but the resolved IP is loopback" deterministically, offline.
const LOCALHOST_CONFIG = loadConfig({ EXCALIDASH_API_KEY: "exd_test", EXCALIDASH_BASE_URL: "https://localhost" });

describe("resolveImages: data: URIs", () => {
  it("passes an inline data: URI through unchanged (the common agent case)", async () => {
    const files: BinaryFiles = { a: file("data:image/png;base64,AAAA") };
    const result = await resolveImages(files, LOCALHOST_CONFIG);
    expect(result.files.a.dataURL).toBe("data:image/png;base64,AAAA");
    expect(result.warnings).toEqual([]);
  });
});

describe("resolveImages: SSRF guard", () => {
  it("rejects a URL resolving to a loopback address even when the host matches the configured origin", async () => {
    const files: BinaryFiles = { a: file("https://localhost/api/files/x.png") };
    const result = await resolveImages(files, LOCALHOST_CONFIG);
    expect(result.files.a).toBeUndefined();
    expect(result.warnings[0]).toMatch(/private\/loopback\/link-local/);
  });

  it("rejects a host that doesn't match the configured EXCALIDASH_BASE_URL origin (no open allow-list)", async () => {
    const files: BinaryFiles = { a: file("https://evil.example.com/x.png") };
    const result = await resolveImages(files, LOCALHOST_CONFIG);
    expect(result.files.a).toBeUndefined();
    expect(result.warnings[0]).toMatch(/not the configured EXCALIDASH_BASE_URL origin/);
  });

  it("rejects a non-TLS (http://) URL by default", async () => {
    const files: BinaryFiles = { a: file("http://localhost/x.png") };
    const result = await resolveImages(files, LOCALHOST_CONFIG);
    expect(result.files.a).toBeUndefined();
    expect(result.warnings[0]).toMatch(/blocked non-TLS/);
  });

  it("allows http:// only when the config explicitly allows insecure (local dev)", async () => {
    // Still loopback-blocked at the IP-resolution stage — this only proves the
    // protocol check itself is bypassed, not that loopback becomes fetchable.
    const insecureConfig = loadConfig({
      EXCALIDASH_API_KEY: "exd_test",
      EXCALIDASH_BASE_URL: "http://localhost",
      EXCALIDASH_ALLOW_INSECURE: "true",
    });
    const files: BinaryFiles = { a: file("http://localhost/x.png") };
    const result = await resolveImages(files, insecureConfig);
    expect(result.warnings[0]).toMatch(/private\/loopback\/link-local/);
    expect(result.warnings[0]).not.toMatch(/non-TLS/);
  });

  it("never throws — an unresolvable image is a warning, not a failed render", async () => {
    const files: BinaryFiles = { a: file("not a url at all") };
    const result = await expect(resolveImages(files, LOCALHOST_CONFIG)).resolves.toBeDefined();
    void result;
  });

  it("drops entries with a missing/non-string dataURL rather than throwing", async () => {
    const files = { a: { id: "a" } } as unknown as BinaryFiles;
    const result = await resolveImages(files, LOCALHOST_CONFIG);
    expect(result.files.a).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("returns an empty result for null/undefined files", async () => {
    expect(await resolveImages(undefined, LOCALHOST_CONFIG)).toEqual({ files: {}, warnings: [] });
    expect(await resolveImages(null, LOCALHOST_CONFIG)).toEqual({ files: {}, warnings: [] });
  });
});

describe("resolveImages: Cloudflare Access headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends CF-Access-Client-Id/Secret headers on the image fetch when configured", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValueOnce({ address: "8.8.8.8", family: 4 });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const config = loadConfig({
      EXCALIDASH_API_KEY: "exd_test",
      EXCALIDASH_BASE_URL: "https://example.com",
      EXCALIDASH_CF_ACCESS_CLIENT_ID: "cid.access",
      EXCALIDASH_CF_ACCESS_CLIENT_SECRET: "shh",
    });
    const files: BinaryFiles = { a: file("https://example.com/api/files/x.png") };
    const result = await resolveImages(files, config);

    expect(result.files.a).toBeDefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["CF-Access-Client-Id"]).toBe("cid.access");
    expect(headers["CF-Access-Client-Secret"]).toBe("shh");
  });

  it("omits Cloudflare Access headers on the image fetch when not configured", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValueOnce({ address: "8.8.8.8", family: 4 });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const config = loadConfig({ EXCALIDASH_API_KEY: "exd_test", EXCALIDASH_BASE_URL: "https://example.com" });
    const files: BinaryFiles = { a: file("https://example.com/api/files/x.png") };
    const result = await resolveImages(files, config);

    expect(result.files.a).toBeDefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["CF-Access-Client-Id"]).toBeUndefined();
    expect(headers["CF-Access-Client-Secret"]).toBeUndefined();
  });
});

describe("isDisallowedIp", () => {
  it("blocks IPv4 loopback/private/link-local/unspecified ranges", () => {
    expect(isDisallowedIp("127.0.0.1")).toBe(true);
    expect(isDisallowedIp("10.1.2.3")).toBe(true);
    expect(isDisallowedIp("172.16.0.5")).toBe(true);
    expect(isDisallowedIp("172.31.255.255")).toBe(true);
    expect(isDisallowedIp("192.168.1.1")).toBe(true);
    expect(isDisallowedIp("169.254.1.1")).toBe(true);
    expect(isDisallowedIp("0.0.0.0")).toBe(true);
  });

  it("allows a public IPv4 address", () => {
    expect(isDisallowedIp("8.8.8.8")).toBe(false);
    expect(isDisallowedIp("172.32.0.1")).toBe(false); // just outside the 172.16/12 private range
  });

  it("blocks IPv6 loopback/unspecified/link-local/unique-local", () => {
    expect(isDisallowedIp("::1")).toBe(true);
    expect(isDisallowedIp("::")).toBe(true);
    expect(isDisallowedIp("fe80::1")).toBe(true);
    expect(isDisallowedIp("fc00::1")).toBe(true);
    expect(isDisallowedIp("fd12:3456::1")).toBe(true);
  });

  it("blocks an IPv4-mapped IPv6 loopback address", () => {
    expect(isDisallowedIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows a public IPv6 address", () => {
    expect(isDisallowedIp("2606:4700:4700::1111")).toBe(false);
  });
});
