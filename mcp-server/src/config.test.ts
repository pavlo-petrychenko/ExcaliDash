import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const BASE_ENV = { EXCALIDASH_API_KEY: "exd_test_key_123" };

describe("loadConfig", () => {
  it("throws ConfigError with an actionable message when EXCALIDASH_API_KEY is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
      expect.unreachable("loadConfig should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain("EXCALIDASH_API_KEY");
    }
  });

  it("throws when EXCALIDASH_API_KEY is present but blank", () => {
    expect(() => loadConfig({ EXCALIDASH_API_KEY: "   " })).toThrow(ConfigError);
  });

  it("applies defaults: base URL, render engine, timeout, clamp", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.apiKey).toBe("exd_test_key_123");
    expect(config.baseUrl).toBe("https://excalidraw.pavlop.dev");
    expect(config.renderEngine).toBe("resvg");
    expect(config.allowInsecure).toBe(false);
    expect(config.requestTimeoutMs).toBe(30000);
    expect(config.maxLongSide).toBe(1200);
  });

  it("strips a trailing slash from EXCALIDASH_BASE_URL", () => {
    const config = loadConfig({ ...BASE_ENV, EXCALIDASH_BASE_URL: "https://example.com/" });
    expect(config.baseUrl).toBe("https://example.com");
  });

  it("rejects an http:// base URL by default", () => {
    expect(() => loadConfig({ ...BASE_ENV, EXCALIDASH_BASE_URL: "http://example.com" })).toThrow(
      ConfigError,
    );
  });

  it("allows an http:// base URL when EXCALIDASH_ALLOW_INSECURE=true", () => {
    const config = loadConfig({
      ...BASE_ENV,
      EXCALIDASH_BASE_URL: "http://localhost:8001",
      EXCALIDASH_ALLOW_INSECURE: "true",
    });
    expect(config.baseUrl).toBe("http://localhost:8001");
    expect(config.allowInsecure).toBe(true);
  });

  it("rejects an unparseable base URL", () => {
    expect(() => loadConfig({ ...BASE_ENV, EXCALIDASH_BASE_URL: "not a url" })).toThrow(
      ConfigError,
    );
  });

  it("accepts EXCALIDASH_RENDER_ENGINE=browser", () => {
    const config = loadConfig({ ...BASE_ENV, EXCALIDASH_RENDER_ENGINE: "browser" });
    expect(config.renderEngine).toBe("browser");
  });

  it("rejects an invalid EXCALIDASH_RENDER_ENGINE", () => {
    expect(() => loadConfig({ ...BASE_ENV, EXCALIDASH_RENDER_ENGINE: "chrome" })).toThrow(
      ConfigError,
    );
  });

  it("rejects a non-positive-integer EXCALIDASH_REQUEST_TIMEOUT_MS", () => {
    expect(() => loadConfig({ ...BASE_ENV, EXCALIDASH_REQUEST_TIMEOUT_MS: "-5" })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ ...BASE_ENV, EXCALIDASH_REQUEST_TIMEOUT_MS: "abc" })).toThrow(
      ConfigError,
    );
  });

  it("parses a custom EXCALIDASH_MAX_LONG_SIDE", () => {
    const config = loadConfig({ ...BASE_ENV, EXCALIDASH_MAX_LONG_SIDE: "800" });
    expect(config.maxLongSide).toBe(800);
  });
});
