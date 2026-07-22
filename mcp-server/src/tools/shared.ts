/**
 * Response-building + error-mapping glue shared by every `tools/*.ts` handler
 * (plan §2's common error mapping, §4-render's "never base64-in-text"). Kept
 * here — not duplicated 8×, not pushed into `api/`/`scene/`/`render/` — because
 * it's pure tool-orchestration: turning this package's own thrown error
 * classes and successful results into the MCP `CallToolResult` shape.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError } from "../api/errors.js";
import { createApiClient, type ApiClient } from "../api/client.js";
import { ConfigError } from "../config.js";
import { CropError } from "../render/crop.js";
import { ClampError } from "../render/clamp.js";
import { RenderEngineError } from "../render/engine.js";
import { LayoutError } from "../scene/layout.js";
import { OpsError } from "../scene/ops.js";
import { RelayoutError } from "../scene/relayout.js";
import { SceneValidationError } from "../scene/normalize.js";
import { SpecError } from "../scene/spec.js";
import { UNTRUSTED_DATA_MARKER } from "../scene/untrusted.js";

/** Every actionable-message error class this package throws; anything else is an unexpected bug and reported as such. */
const KNOWN_ERROR_TYPES = [
  ApiError,
  ConfigError,
  CropError,
  ClampError,
  RenderEngineError,
  LayoutError,
  OpsError,
  RelayoutError,
  SceneValidationError,
  SpecError,
] as const;

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function imageResult(png: Buffer, caption?: string): CallToolResult {
  const imageBlock = { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" as const };
  return caption ? { content: [{ type: "text", text: caption }, imageBlock] } : { content: [imageBlock] };
}

/** A validation failure this package's own input schema/business logic raised — no traceback, just guidance. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/**
 * Central error→`CallToolResult` mapping (plan §2's "Common error mapping").
 * Every tool handler should be wrapped with `runTool()` below rather than
 * calling this directly, but it's exported for tests that want to assert the
 * exact text a given error class produces.
 */
export function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof ToolInputError) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
  for (const ErrorType of KNOWN_ERROR_TYPES) {
    if (error instanceof ErrorType) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `excalidash-mcp: unexpected error: ${message}` }],
    isError: true,
  };
}

/**
 * Wraps a tool handler that talks to the ExcaliDash backend: builds the
 * `ApiClient` (which reads `EXCALIDASH_API_KEY` via `getConfig()`) and maps any
 * thrown error (ours, a `ConfigError`, or otherwise) to an `isError:true`
 * result instead of an uncaught rejection.
 */
export function runTool<Args>(handler: (args: Args, client: ApiClient) => Promise<CallToolResult>): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return await handler(args, createApiClient());
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

/**
 * Wraps a tool handler that never touches the ExcaliDash backend (today, only
 * `excalidash_guide`) — deliberately does NOT construct an `ApiClient`/call
 * `getConfig()`, so a purely local, in-band-reference tool keeps working even
 * before `EXCALIDASH_API_KEY` is configured.
 */
export function runLocalTool<Args>(handler: (args: Args) => Promise<CallToolResult>): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return await handler(args);
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

/** Quotes a value for markdown, pairing an id with a human name per 06-mcp-best-practices.md §5.3 ("never bare UUIDs"). */
export function idWithName(id: string, name: string): string {
  return `${name} (id: ${id})`;
}

/** Coarse relative-time formatting for list/get responses ("3 minutes ago", "on 2026-01-01") — no extra dependency. */
export function formatRelativeTime(isoTimestamp: string, now: Date = new Date()): string {
  const then = new Date(isoTimestamp);
  const diffMs = now.getTime() - then.getTime();
  if (!Number.isFinite(diffMs)) return isoTimestamp;
  if (diffMs < 0) return `on ${then.toISOString().slice(0, 10)}`;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `on ${then.toISOString().slice(0, 10)}`;
}

/** Prefixes text with the untrusted-data marker only when it isn't already there (avoids double-prefixing composed content). */
export function ensureUntrustedMarker(text: string): string {
  return text.startsWith(UNTRUSTED_DATA_MARKER) ? text : `${UNTRUSTED_DATA_MARKER}\n\n${text}`;
}

/** JSON-stringifies a value for a `response_format:"json"` text block (never returned as base64/binary — see module doc). */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
