import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors.js";
import { resetConfigCacheForTests } from "../config.js";
import { CropError } from "../render/crop.js";
import { SceneValidationError } from "../scene/normalize.js";
import {
  ensureUntrustedMarker,
  formatRelativeTime,
  idWithName,
  imageResult,
  jsonText,
  runLocalTool,
  runTool,
  textResult,
  toErrorResult,
  ToolInputError,
} from "./shared.js";

describe("textResult / imageResult", () => {
  it("textResult produces a single text content block", () => {
    expect(textResult("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
  });

  it("imageResult produces a native image block with base64 data, optionally captioned", () => {
    const png = Buffer.from([1, 2, 3]);
    const result = imageResult(png, "caption");
    expect(result.content).toEqual([
      { type: "text", text: "caption" },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ]);
  });

  it("imageResult without a caption returns only the image block", () => {
    const png = Buffer.from([1]);
    const result = imageResult(png);
    expect(result.content).toEqual([{ type: "image", data: png.toString("base64"), mimeType: "image/png" }]);
  });
});

describe("toErrorResult", () => {
  it.each([
    new ToolInputError("needs new_name"),
    new ApiError("forbidden", "API key lacks scope"),
    new CropError("mode requires region"),
    new SceneValidationError(["bad scene"]),
  ])("maps a known error class to isError:true text (%#)", (error) => {
    const result = toErrorResult(error);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe(error.message);
  });

  it("maps an unrecognized error to a generic, still-actionable isError:true text", () => {
    const result = toErrorResult(new TypeError("boom"));
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("boom");
  });

  it("maps a thrown non-Error value without crashing", () => {
    const result = toErrorResult("just a string");
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("just a string");
  });
});

describe("runTool / runLocalTool", () => {
  beforeEach(() => {
    vi.stubEnv("EXCALIDASH_API_KEY", "exd_test_test_test");
    resetConfigCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigCacheForTests();
  });

  it("runTool passes a constructed ApiClient to the handler and returns its result", async () => {
    const handler = runTool(async (_args: { x: number }, client) => {
      expect(client).toBeDefined();
      expect(typeof client.request).toBe("function");
      return textResult("ok");
    });
    const result = await handler({ x: 1 });
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("runTool converts a thrown error into an isError:true result instead of rejecting", async () => {
    const handler = runTool(async () => {
      throw new ToolInputError("bad input");
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
  });

  it("runLocalTool does not require EXCALIDASH_API_KEY at all", async () => {
    vi.unstubAllEnvs();
    resetConfigCacheForTests();
    const handler = runLocalTool(async (_args: Record<string, never>) => textResult("local ok"));
    const result = await handler({});
    expect(result).toEqual({ content: [{ type: "text", text: "local ok" }] });
  });
});

describe("idWithName", () => {
  it("pairs an id with a human name", () => {
    expect(idWithName("abc123", "Architecture v2")).toBe("Architecture v2 (id: abc123)");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");

  it("formats sub-minute as 'just now'", () => {
    expect(formatRelativeTime("2026-01-02T11:59:45.000Z", now)).toBe("just now");
  });

  it("formats minutes ago", () => {
    expect(formatRelativeTime("2026-01-02T11:55:00.000Z", now)).toBe("5 minutes ago");
  });

  it("formats hours ago", () => {
    expect(formatRelativeTime("2026-01-02T09:00:00.000Z", now)).toBe("3 hours ago");
  });

  it("formats days ago", () => {
    expect(formatRelativeTime("2025-12-30T12:00:00.000Z", now)).toBe("3 days ago");
  });

  it("falls back to a date for anything a month+ old", () => {
    expect(formatRelativeTime("2025-01-01T00:00:00.000Z", now)).toBe("on 2025-01-01");
  });

  it("falls back to a date for a future timestamp (clock skew) rather than a negative duration", () => {
    expect(formatRelativeTime("2026-01-03T00:00:00.000Z", now)).toBe("on 2026-01-03");
  });
});

describe("ensureUntrustedMarker", () => {
  it("prefixes text that doesn't already carry the marker", () => {
    expect(ensureUntrustedMarker("hello")).toContain("untrusted data");
    expect(ensureUntrustedMarker("hello")).toContain("hello");
  });

  it("does not double-prefix text that already carries the marker", () => {
    const once = ensureUntrustedMarker("hello");
    expect(ensureUntrustedMarker(once)).toBe(once);
  });
});

describe("jsonText", () => {
  it("pretty-prints JSON", () => {
    expect(jsonText({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
  });
});
