/**
 * HTTP status -> actionable message mapping, shared by every tool (plan §2,
 * "Common error mapping"). Every mutating/reading call in `api/*.ts` funnels its
 * non-2xx response through `mapHttpError`, and every network/timeout failure
 * through `mapNetworkError`, so callers always see one `ApiError` shape.
 */

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "network"
  | "http";

export interface ApiErrorOptions {
  status?: number;
  /** Present for 409 VERSION_CONFLICT responses (backend's `currentVersion` field). */
  currentVersion?: number;
  cause?: unknown;
}

/** Uniform error shape thrown by `api/client.ts` and re-thrown verbatim by tools. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly currentVersion?: number;

  constructor(kind: ApiErrorKind, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status;
    this.currentVersion = options.currentVersion;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function extractString(body: unknown, field: string): string | undefined {
  if (body && typeof body === "object" && field in body) {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function extractNumber(body: unknown, field: string): number | undefined {
  if (body && typeof body === "object" && field in body) {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === "number") return value;
  }
  return undefined;
}

/** Maps a non-2xx HTTP response (status + parsed JSON body, if any) to an `ApiError`. */
export function mapHttpError(status: number, body: unknown): ApiError {
  const backendMessage = extractString(body, "message");
  switch (status) {
    case 401:
      return new ApiError("unauthorized", "API key invalid or missing; set EXCALIDASH_API_KEY.", {
        status,
      });
    case 403:
      return new ApiError(
        "forbidden",
        backendMessage
          ? `API key lacks the required scope, or you are not the owner of this drawing (${backendMessage}).`
          : "API key lacks the required scope, or you are not the owner of this drawing.",
        { status },
      );
    case 404:
      return new ApiError("not_found", "Not found; call excalidash_list_drawings first.", { status });
    case 409:
      return new ApiError(
        "conflict",
        "Drawing changed concurrently (someone has it open) — re-read and retry.",
        { status, currentVersion: extractNumber(body, "currentVersion") },
      );
    case 429:
      return new ApiError("rate_limited", "Rate limited by the ExcaliDash backend; wait and retry.", {
        status,
      });
    default:
      return new ApiError(
        "http",
        backendMessage
          ? `ExcaliDash backend returned HTTP ${status}: ${backendMessage}`
          : `ExcaliDash backend returned HTTP ${status}.`,
        { status },
      );
  }
}

/**
 * Maps a manually-intercepted 3xx response (client.ts always sends `redirect: "manual"`,
 * so a redirect is surfaced here rather than silently followed) to an `ApiError`. A
 * `Location` pointing at `cloudflareaccess.com` means the ExcaliDash backend sits behind
 * Cloudflare Access and every request needs a service token — name the two env vars so
 * the fix is actionable instead of a generic "unexpected redirect".
 */
export function mapRedirectError(status: number, location: string | null, baseUrl: string): ApiError {
  if (location?.includes("cloudflareaccess.com")) {
    return new ApiError(
      "network",
      `ExcaliDash backend at ${baseUrl} is behind Cloudflare Access (redirected to ${location}). ` +
        "Set EXCALIDASH_CF_ACCESS_CLIENT_ID and EXCALIDASH_CF_ACCESS_CLIENT_SECRET to a Cloudflare Access " +
        "service token for this Access application.",
      { status },
    );
  }
  return new ApiError(
    "network",
    `ExcaliDash backend at ${baseUrl} returned an unexpected redirect (HTTP ${status}); refusing to follow it.`,
    { status },
  );
}

/** Maps a fetch-level failure (DNS/TLS/connection refused, or our own timeout abort) to an `ApiError`. */
export function mapNetworkError(error: unknown, baseUrl: string): ApiError {
  if (error instanceof Error && error.name === "AbortError") {
    return new ApiError(
      "network",
      `Timed out reaching ${baseUrl} (EXCALIDASH_REQUEST_TIMEOUT_MS exceeded).`,
      { cause: error },
    );
  }
  return new ApiError("network", `Cannot reach EXCALIDASH_BASE_URL over https (${baseUrl}).`, {
    cause: error,
  });
}
