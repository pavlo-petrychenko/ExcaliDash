/**
 * Authenticated HTTP client for the ExcaliDash backend (plan §1, §3).
 *
 * Every call: `Authorization: Bearer <apiKey>`, https-only (http rejected unless
 * `allowInsecure`), `redirect: "manual"` (never silently follow a redirect),
 * a request timeout, and JSON in/out. Non-2xx responses and network failures are
 * mapped to `ApiError` (`./errors.ts`) so every tool sees one uniform error shape.
 *
 * stdout is reserved for JSON-RPC; any diagnostic here goes to stderr with the
 * API key redacted — never log `Authorization` or the raw key.
 */
import { getConfig, type McpConfig } from "../config.js";
import { ApiError, mapHttpError, mapNetworkError } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD";

export interface ApiRequestOptions {
  /** Query-string params; `undefined` values are omitted. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON request body, if any (sent for POST/PUT/DELETE). */
  body?: unknown;
}

export interface ApiClient {
  request<T = unknown>(method: HttpMethod, path: string, options?: ApiRequestOptions): Promise<T>;
}

function assertAllowedProtocol(baseUrl: string, allowInsecure: boolean): void {
  const protocol = new URL(baseUrl).protocol;
  if (protocol !== "https:" && !(allowInsecure && protocol === "http:")) {
    throw new ApiError(
      "network",
      `EXCALIDASH_BASE_URL must use https:// (got "${protocol}//..."). ` +
        "Set EXCALIDASH_ALLOW_INSECURE=true only for trusted local development over http.",
    );
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: ApiRequestOptions["query"],
): string {
  const url = new URL(`${baseUrl}/api${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Replaces every occurrence of the raw API key in `text` — used before anything hits stderr. */
function redact(apiKey: string, text: string): string {
  return apiKey ? text.split(apiKey).join("[REDACTED]") : text;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Builds an `ApiClient` bound to the given config (defaults to the process-wide
 * singleton). Validates the base-URL protocol eagerly so a misconfigured client
 * fails at construction rather than on first use.
 */
export function createApiClient(config: McpConfig = getConfig()): ApiClient {
  assertAllowedProtocol(config.baseUrl, config.allowInsecure);

  return {
    async request<T>(
      method: HttpMethod,
      path: string,
      options: ApiRequestOptions = {},
    ): Promise<T> {
      const url = buildUrl(config.baseUrl, path, options.query);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            Accept: "application/json",
            ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        throw mapNetworkError(error, config.baseUrl);
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const error = new ApiError(
          "network",
          `ExcaliDash backend at ${config.baseUrl} returned an unexpected redirect (HTTP ${response.status}); refusing to follow it.`,
          { status: response.status },
        );
        logRequestError(config.apiKey, method, path, error);
        throw error;
      }

      const json = await parseJsonBody(response);

      if (!response.ok) {
        const error = mapHttpError(response.status, json);
        logRequestError(config.apiKey, method, path, error);
        throw error;
      }

      return json as T;
    },
  };
}

function logRequestError(apiKey: string, method: HttpMethod, path: string, error: ApiError): void {
  const line = redact(
    apiKey,
    `[excalidash-mcp] ${method} ${path} -> ${error.status ?? "network"}: ${error.message}`,
  );
  console.error(line);
}
