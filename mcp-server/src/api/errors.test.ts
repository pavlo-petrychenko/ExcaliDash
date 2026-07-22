import { describe, expect, it } from "vitest";
import { ApiError, mapHttpError, mapNetworkError } from "./errors.js";

describe("mapHttpError", () => {
  it("maps 401 to an actionable unauthorized message", () => {
    const error = mapHttpError(401, undefined);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("unauthorized");
    expect(error.message).toContain("EXCALIDASH_API_KEY");
  });

  it("maps 403 to a scope/ownership message, folding in the backend message", () => {
    const error = mapHttpError(403, { message: "missing scope drawings:write" });
    expect(error.kind).toBe("forbidden");
    expect(error.message).toContain("scope");
    expect(error.message).toContain("missing scope drawings:write");
  });

  it("maps 403 without a backend message to the generic form", () => {
    const error = mapHttpError(403, undefined);
    expect(error.kind).toBe("forbidden");
    expect(error.message).toContain("owner");
  });

  it("maps 404 to call-list-drawings-first guidance", () => {
    const error = mapHttpError(404, undefined);
    expect(error.kind).toBe("not_found");
    expect(error.message).toContain("excalidash_list_drawings");
  });

  it("maps 409 to the concurrent-edit message and extracts currentVersion", () => {
    const error = mapHttpError(409, { code: "VERSION_CONFLICT", currentVersion: 7 });
    expect(error.kind).toBe("conflict");
    expect(error.message).toContain("re-read and retry");
    expect(error.currentVersion).toBe(7);
  });

  it("maps 429 to a rate-limit message", () => {
    const error = mapHttpError(429, undefined);
    expect(error.kind).toBe("rate_limited");
    expect(error.message).toContain("Rate limited");
  });

  it("falls back to a generic http message for unmapped statuses", () => {
    const error = mapHttpError(500, { message: "boom" });
    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(error.message).toContain("500");
    expect(error.message).toContain("boom");
  });

  it("ignores a non-string message field", () => {
    const error = mapHttpError(500, { message: 12345 });
    expect(error.message).not.toContain("12345");
  });
});

describe("mapNetworkError", () => {
  it("maps an AbortError to a timeout message", () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const error = mapNetworkError(abort, "https://excalidraw.pavlop.dev");
    expect(error.kind).toBe("network");
    expect(error.message).toContain("Timed out");
    expect(error.cause).toBe(abort);
  });

  it("maps any other error to a cannot-reach message", () => {
    const cause = new Error("ECONNREFUSED");
    const error = mapNetworkError(cause, "https://excalidraw.pavlop.dev");
    expect(error.kind).toBe("network");
    expect(error.message).toContain("Cannot reach");
    expect(error.cause).toBe(cause);
  });
});
