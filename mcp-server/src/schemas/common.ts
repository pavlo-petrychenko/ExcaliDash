/**
 * Shared zod pieces + the pagination envelope (plan §2, §5.5 in 06-mcp-best-
 * practices.md): `response_format`, a reusable `drawing_id` field, the loosely-
 * typed "skeleton/raw element" shape used by the power-user/escape-hatch inputs
 * on `create_diagram`/`edit_diagram`, the allow-listed `appState` subset those
 * same tools may set, and `buildPaginationEnvelope()` for list tools.
 */
import { z } from "zod";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../constants.js";

export const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("'markdown' for a human-readable response, or 'json' for a machine-parseable one.");
export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

export const DrawingIdSchema = z
  .string()
  .min(1)
  .describe("The drawing's id, as returned by excalidash_list_drawings/excalidash_create_diagram.");

/**
 * One entry of an `ExcalidrawElementSkeleton[]` (power-user path) or a raw
 * persisted element (escape-hatch `elements` path). Both are validated
 * structurally by `scene/normalize.ts`'s `convertToExcalidrawElements`/
 * `restoreElements` + `validateScene()` — deliberately NOT re-modeled field-by-
 * field here (that would duplicate Excalidraw's own, much larger, element type
 * union). This schema only pins down what every entry must have to be
 * meaningful at all: a `type` string. `.catchall()` (not `.strict()`) lets every
 * other Excalidraw field through untouched.
 */
export const SkeletonEntrySchema = z.object({ type: z.string().min(1) }).catchall(z.unknown());
export type SkeletonEntryInput = z.infer<typeof SkeletonEntrySchema>;

/**
 * `appState` fields `create_diagram`/`edit_diagram` may set (plan §2.4:
 * "appState? (allow-listed: viewBackgroundColor/gridSize/…)"). Kept deliberately
 * small — anything not on this list (e.g. `collaborators`, `selectedElementIds`)
 * is UI/session state that has no business being agent-authored.
 */
export const AllowedAppStateSchema = z
  .object({
    viewBackgroundColor: z.string().optional().describe("Canvas background color hex, e.g. '#ffffff'."),
    gridSize: z.number().int().positive().optional().describe("Grid size in px; omit to leave the grid off."),
  })
  .strict();
export type AllowedAppState = z.infer<typeof AllowedAppStateSchema>;

export interface PaginationEnvelope<T> {
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  items: T[];
}

/** Standard pagination envelope (plan §2.1, 06-mcp-best-practices.md §5.5). */
export function buildPaginationEnvelope<T>(total: number, offset: number, items: T[]): PaginationEnvelope<T> {
  const hasMore = total > offset + items.length;
  return {
    total,
    count: items.length,
    offset,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + items.length } : {}),
    items,
  };
}

export const LimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIST_LIMIT)
  .default(DEFAULT_LIST_LIMIT)
  .describe(`Max results to return (1-${MAX_LIST_LIMIT}).`);

export const OffsetSchema = z.number().int().min(0).default(0).describe("Number of results to skip (pagination).");
