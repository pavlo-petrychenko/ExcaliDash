/**
 * Typed `/drawings*` calls (plan §3, §5, §14 in 03-data-model.md). Elements/
 * appState/files are kept loosely typed here (`unknown[]`/`Record<string,
 * unknown>`) — the backend's own schema is a permissive passthrough, and the
 * real Excalidraw element contract is enforced by `scene/normalize.ts` (T4),
 * not by this API layer.
 */
import type { ApiClient } from "./client.js";
import { ApiError } from "./errors.js";

export type AccessLevel = "owner" | "edit" | "view";

export interface DrawingSummary {
  id: string;
  name: string;
  collectionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  preview?: string | null;
  accessLevel?: AccessLevel;
}

export interface DrawingRecord extends DrawingSummary {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown> | null;
}

export interface ListDrawingsParams {
  search?: string;
  /** A collection id, `"null"` (uncategorized) or `"trash"`. */
  collectionId?: string;
  includeData?: boolean;
  includePreview?: boolean;
  limit?: number;
  offset?: number;
  sortField?: "name" | "createdAt" | "updatedAt";
  sortDirection?: "asc" | "desc";
}

export interface ListDrawingsResponse {
  drawings: (DrawingSummary | DrawingRecord)[];
  totalCount: number;
  limit: number | null;
  offset: number;
}

function listQuery(params: ListDrawingsParams): Record<string, string | number | boolean | undefined> {
  return {
    search: params.search,
    collectionId: params.collectionId,
    includeData: params.includeData,
    includePreview: params.includePreview,
    limit: params.limit,
    offset: params.offset,
    sortField: params.sortField,
    sortDirection: params.sortDirection,
  };
}

/** `GET /drawings` — the caller's own drawings (plan §2.1). */
export async function listDrawings(
  client: ApiClient,
  params: ListDrawingsParams = {},
): Promise<ListDrawingsResponse> {
  return client.request<ListDrawingsResponse>("GET", "/drawings", { query: listQuery(params) });
}

/** `GET /drawings/shared` — drawings shared *with* the caller (plan §0.2 #3). */
export async function listSharedDrawings(
  client: ApiClient,
  params: ListDrawingsParams = {},
): Promise<ListDrawingsResponse> {
  return client.request<ListDrawingsResponse>("GET", "/drawings/shared", { query: listQuery(params) });
}

/** `GET /drawings/:id` — full row incl. parsed elements/appState/files + version. */
export async function getDrawing(client: ApiClient, drawingId: string): Promise<DrawingRecord> {
  return client.request<DrawingRecord>("GET", `/drawings/${encodeURIComponent(drawingId)}`);
}

export interface CreateDrawingInput {
  name?: string;
  collectionId?: string | null;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown> | null;
  preview?: string | null;
}

/** `POST /drawings` — create. */
export async function createDrawing(
  client: ApiClient,
  input: CreateDrawingInput,
): Promise<DrawingRecord> {
  return client.request<DrawingRecord>("POST", "/drawings", { body: input });
}

export interface UpdateDrawingInput {
  name?: string;
  collectionId?: string | null;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown> | null;
  preview?: string | null;
  /** Optimistic-concurrency token; required whenever `elements`/`appState`/`files` is set. */
  version?: number;
}

/**
 * `PUT /drawings/:id` — partial update. Any of `elements`/`appState`/`files`
 * present makes this a *whole-scene replace* for those fields (never a partial
 * array) and, when `version` is also given, is subject to the backend's 409
 * `VERSION_CONFLICT` check (plan §5).
 */
export async function updateDrawing(
  client: ApiClient,
  drawingId: string,
  input: UpdateDrawingInput,
): Promise<DrawingRecord> {
  return client.request<DrawingRecord>("PUT", `/drawings/${encodeURIComponent(drawingId)}`, {
    body: input,
  });
}

/** `DELETE /drawings/:id` — hard delete, single id only (plan §2.6). */
export async function deleteDrawing(client: ApiClient, drawingId: string): Promise<void> {
  await client.request<unknown>("DELETE", `/drawings/${encodeURIComponent(drawingId)}`);
}

/** `POST /drawings/:id/duplicate` — safety copy (plan §3.1). */
export async function duplicateDrawing(client: ApiClient, drawingId: string): Promise<DrawingRecord> {
  return client.request<DrawingRecord>(
    "POST",
    `/drawings/${encodeURIComponent(drawingId)}/duplicate`,
  );
}

export interface SnapshotSummary {
  id: string;
  version: number;
  createdAt: string;
}

export interface HistoryListResponse {
  snapshots: SnapshotSummary[];
  totalCount: number;
}

/** `GET /drawings/:id/history` — snapshot metadata only, 48h retention (plan §5). */
export async function listDrawingHistory(
  client: ApiClient,
  drawingId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<HistoryListResponse> {
  return client.request<HistoryListResponse>(
    "GET",
    `/drawings/${encodeURIComponent(drawingId)}/history`,
    { query: { limit: params.limit, offset: params.offset } },
  );
}

export interface SnapshotDetail extends SnapshotSummary {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** `GET /drawings/:id/history/:snapshotId` — full snapshot payload. */
export async function getDrawingSnapshot(
  client: ApiClient,
  drawingId: string,
  snapshotId: string,
): Promise<SnapshotDetail> {
  return client.request<SnapshotDetail>(
    "GET",
    `/drawings/${encodeURIComponent(drawingId)}/history/${encodeURIComponent(snapshotId)}`,
  );
}

/** `POST /drawings/:id/history/:snapshotId/restore` — overwrite the live drawing from a snapshot. */
export async function restoreDrawingSnapshot(
  client: ApiClient,
  drawingId: string,
  snapshotId: string,
): Promise<DrawingRecord> {
  return client.request<DrawingRecord>(
    "POST",
    `/drawings/${encodeURIComponent(drawingId)}/history/${encodeURIComponent(snapshotId)}/restore`,
  );
}

export interface UpdateWithVersionRetryResult {
  drawing: DrawingRecord;
  /** True if the first PUT hit a 409 and this result came from the one retry. */
  retried: boolean;
}

/**
 * Version-conflict helper (plan §2.5, §5): reads the current drawing, builds the
 * update from it via `buildUpdate`, and PUTs. On a 409 `VERSION_CONFLICT` it
 * re-reads once, rebuilds the update against the fresh state, and retries
 * exactly once — never a blind overwrite. A second conflict (or any other
 * error) propagates to the caller as-is so it can be surfaced verbatim.
 *
 * `buildUpdate` may return a `Promise` — `edit_diagram` (T7) needs this to run
 * the async declarative-ops pipeline (`scene/ops.ts`'s `applyOps`, itself async
 * because it awaits the bundled Excalidraw core) once per attempt, on top of
 * whichever `current` this call is being retried against. It may also throw
 * (e.g. an `expected_version` mismatch it detects against `current.version`) to
 * abort a specific attempt without a PUT ever being sent for it.
 */
export async function updateDrawingWithVersionRetry(
  client: ApiClient,
  drawingId: string,
  buildUpdate: (current: DrawingRecord) => UpdateDrawingInput | Promise<UpdateDrawingInput>,
): Promise<UpdateWithVersionRetryResult> {
  const current = await getDrawing(client, drawingId);
  try {
    const drawing = await updateDrawing(client, drawingId, await buildUpdate(current));
    return { drawing, retried: false };
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== "conflict") throw error;
    const fresh = await getDrawing(client, drawingId);
    const drawing = await updateDrawing(client, drawingId, await buildUpdate(fresh));
    return { drawing, retried: true };
  }
}
