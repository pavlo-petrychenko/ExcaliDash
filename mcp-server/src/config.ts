/**
 * Environment parsing for the excalidash-mcp server.
 *
 * `loadConfig()` is a pure function (given an env map) so it is unit-testable
 * without mutating `process.env`. `getConfig()` is the runtime singleton that
 * later modules (api/client.ts, render/engine.ts, ...) should call — it parses
 * once, on first use, and reuses the result.
 *
 * Only `index.ts` should call `loadConfig()` directly at startup, so a missing/
 * invalid `EXCALIDASH_API_KEY` fails fast with an actionable stderr message
 * before any transport is wired up (see plan §1, §6 point 1).
 */
import { DEFAULT_BASE_URL, DEFAULT_MAX_LONG_SIDE, DEFAULT_REQUEST_TIMEOUT_MS } from "./constants.js";

export type RenderEngine = "resvg" | "browser";

export interface McpConfig {
  /** Scoped ExcaliDash API key (`exd_<keyId>_<secret>`), sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** ExcaliDash backend origin, e.g. `https://excalidraw.pavlop.dev`. Always required to be https unless allowInsecure. */
  baseUrl: string;
  /** Which render backend to use for `excalidash_render`. Default `resvg` (no browser download). */
  renderEngine: RenderEngine;
  /** Allow `http://` base URLs (local dev only). Default false. */
  allowInsecure: boolean;
  /** Request timeout (ms) for calls to the ExcaliDash backend. */
  requestTimeoutMs: number;
  /** Default longest-side pixel clamp applied to rendered images. */
  maxLongSide: number;
}

/** Thrown for any invalid/missing configuration; callers print `.message` to stderr and exit(1). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseRenderEngine(raw: string | undefined): RenderEngine {
  if (raw === undefined || raw === "") return "resvg";
  if (raw === "resvg" || raw === "browser") return raw;
  throw new ConfigError(
    `EXCALIDASH_RENDER_ENGINE must be "resvg" or "browser" (got "${raw}"). Default "resvg" needs no browser install.`,
  );
}

function parseBoolean(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer (got "${raw}").`);
  }
  return value;
}

function parseBaseUrl(raw: string | undefined, allowInsecure: boolean): string {
  const value = raw?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`EXCALIDASH_BASE_URL is not a valid URL: "${value}".`);
  }
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    throw new ConfigError(
      `EXCALIDASH_BASE_URL must use https:// (got "${url.protocol}//..."). ` +
        "Set EXCALIDASH_ALLOW_INSECURE=true only for trusted local development over http.",
    );
  }
  // Normalize away a trailing slash so callers can safely do `${baseUrl}/api/...`.
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Parses and validates the excalidash-mcp environment. Pure function (no caching, no
 * process.exit) so tests can pass an arbitrary env map and assert on thrown ConfigError.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const apiKey = env.EXCALIDASH_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      "EXCALIDASH_API_KEY environment variable is required. Create a scoped API key at " +
        `${env.EXCALIDASH_BASE_URL?.trim() || DEFAULT_BASE_URL}/profile (API Keys), then pass it via ` +
        '`claude mcp add --scope user --transport stdio excalidash --env EXCALIDASH_API_KEY=exd_... -- ...`.',
    );
  }

  const allowInsecure = parseBoolean(env.EXCALIDASH_ALLOW_INSECURE);
  const baseUrl = parseBaseUrl(env.EXCALIDASH_BASE_URL, allowInsecure);
  const renderEngine = parseRenderEngine(env.EXCALIDASH_RENDER_ENGINE);
  const requestTimeoutMs = parsePositiveInt(
    env.EXCALIDASH_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    "EXCALIDASH_REQUEST_TIMEOUT_MS",
  );
  const maxLongSide = parsePositiveInt(
    env.EXCALIDASH_MAX_LONG_SIDE,
    DEFAULT_MAX_LONG_SIDE,
    "EXCALIDASH_MAX_LONG_SIDE",
  );

  return { apiKey, baseUrl, renderEngine, allowInsecure, requestTimeoutMs, maxLongSide };
}

let cachedConfig: McpConfig | undefined;

/**
 * Runtime singleton: parses `process.env` on first call and caches the result for the
 * lifetime of the process. Use this from anywhere other than `index.ts`'s startup check.
 */
export function getConfig(): McpConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/** Test-only escape hatch to force re-parsing on the next `getConfig()` call. */
export function resetConfigCacheForTests(): void {
  cachedConfig = undefined;
}
