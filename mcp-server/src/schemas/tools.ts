/**
 * Per-tool zod input schemas (plan §2): one schema per `excalidash_*` tool,
 * `.strict()` throughout so an agent's guessed/invented field fails fast with a
 * zod error instead of being silently dropped. Every field carries a
 * `.describe()` — per plan §2, these are written "as if to a new teammate":
 * they state the coordinate system, units, binding-by-id rule, and (for
 * read/render tools) that returned scene content is untrusted data.
 *
 * `add`/`replace_all` ops and `create_diagram` all accept exactly one of
 * `spec`/`skeleton`/`elements` — `exactlyOneAuthoringInput()` is the one place
 * that "exactly one of" rule is enforced, applied via `.superRefine()` so the
 * error message names the offending fields instead of a generic zod complaint.
 */
import { z } from "zod";
import { DiagramSpecSchema } from "./spec.js";
import {
  AllowedAppStateSchema,
  DrawingIdSchema,
  LimitSchema,
  OffsetSchema,
  ResponseFormatSchema,
  SkeletonEntrySchema,
} from "./common.js";

/** Shared "exactly one of spec/skeleton/elements" check, reused by create_diagram and each add/replace_all op. */
function exactlyOneAuthoringInput<T extends { spec?: unknown; skeleton?: unknown; elements?: unknown }>(
  value: T,
  ctx: z.RefinementCtx,
  context: string,
  path?: Array<string | number>,
): void {
  const provided = (["spec", "skeleton", "elements"] as const).filter((key) => value[key] !== undefined);
  if (provided.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${context} needs exactly one of spec/skeleton/elements (got ${provided.length}: [${provided.join(", ")}]).`,
      ...(path ? { path } : {}),
    });
  }
}

const AuthoringInputShape = {
  spec: DiagramSpecSchema.optional().describe(
    "The ergonomic default: nodes + edges + a layout strategy. scene/layout.ts auto-positions everything.",
  ),
  skeleton: z
    .array(SkeletonEntrySchema)
    .min(1)
    .optional()
    .describe(
      "Power-user path: an ExcalidrawElementSkeleton[] (each entry needs at least a 'type'; x/y/width/height/label/etc. as usual). " +
        "Auto-wires bindings/indices via convertToExcalidrawElements — never hand-author fractional indices.",
    ),
  elements: z
    .array(SkeletonEntrySchema)
    .min(1)
    .optional()
    .describe(
      "Escape hatch: a raw Excalidraw elements array (already-complete elements, e.g. round-tripped from excalidash_get_drawing view:'full'). " +
        "Repaired via restoreElements before use.",
    ),
};

// ---------------------------------------------------------------------------
// 2.1 excalidash_list_drawings
// ---------------------------------------------------------------------------
export const ListDrawingsInputSchema = z
  .object({
    query: z.string().min(2).max(200).optional().describe("Filter drawings by name (substring match). Omit to list all."),
    scope: z
      .enum(["mine", "shared", "all"])
      .default("mine")
      .describe("'mine'=drawings you own, 'shared'=drawings shared with you, 'all'=both, merged and re-sorted by updatedAt."),
    collection_id: z
      .string()
      .optional()
      .describe("Restrict to one collection's drawings (id from excalidash_collections action:'list'). Only applies to scope 'mine'/'all'."),
    limit: LimitSchema,
    offset: OffsetSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();
export type ListDrawingsInput = z.infer<typeof ListDrawingsInputSchema>;

// ---------------------------------------------------------------------------
// 2.2 excalidash_get_drawing
// ---------------------------------------------------------------------------
export const GetDrawingInputSchema = z
  .object({
    drawing_id: DrawingIdSchema,
    view: z
      .enum(["summary", "full"])
      .default("summary")
      .describe(
        "'summary'=cheap counts/nodes/edges/bounds (recommended first look). 'full'=the parsed elements/appState/files " +
          "(large; downgrades to summary automatically if it would exceed the response size limit).",
      ),
    response_format: ResponseFormatSchema,
  })
  .strict();
export type GetDrawingInput = z.infer<typeof GetDrawingInputSchema>;

// ---------------------------------------------------------------------------
// 2.3 excalidash_render
// ---------------------------------------------------------------------------
const RegionSchema = z
  .object({
    x: z.number().describe("Left edge, px, in the drawing's own coordinate space (top-left origin, y grows down)."),
    y: z.number().describe("Top edge, px."),
    width: z.number().positive().describe("Region width, px."),
    height: z.number().positive().describe("Region height, px."),
  })
  .strict();

export const RenderInputSchema = z
  .object({
    drawing_id: DrawingIdSchema,
    mode: z
      .enum(["full", "region", "elements", "frame"])
      .default("full")
      .describe("'full'=whole scene. 'region' needs `region`. 'elements' needs `element_ids`. 'frame' needs `frame_id`."),
    region: RegionSchema.optional().describe("Required when mode is 'region'."),
    element_ids: z.array(z.string()).min(1).optional().describe("Required when mode is 'elements'."),
    frame_id: z.string().optional().describe("Required when mode is 'frame'."),
    scale: z.number().positive().default(1).describe("Zoom factor before the max_width clamp is applied."),
    max_width: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Longest output side in px; defaults to the server's configured clamp (EXCALIDASH_MAX_LONG_SIDE, 1200 by default)."),
    background: z
      .enum(["white", "transparent", "theme"])
      .default("white")
      .describe("'white'/'transparent' force a compositing background; 'theme' uses the scene's own viewBackgroundColor."),
    format: z
      .enum(["png", "svg"])
      .default("png")
      .describe("'png' returns a native image content block (cheap in tokens). 'svg' returns markup as text — for humans, not for re-rendering by you."),
  })
  .strict();
export type RenderInput = z.infer<typeof RenderInputSchema>;

// ---------------------------------------------------------------------------
// 2.4 excalidash_create_diagram
// ---------------------------------------------------------------------------
export const CreateDiagramInputSchema = z
  .object({
    name: z.string().min(1).describe("Drawing name shown in the ExcaliDash dashboard."),
    ...AuthoringInputShape,
    collection_id: z.string().optional().describe("Collection to file the new drawing under; omit to leave it uncategorized."),
    background_color: z.string().optional().describe("Canvas background color hex, e.g. '#ffffff'. Shorthand for appState.viewBackgroundColor."),
    app_state: AllowedAppStateSchema.optional().describe("Additional allow-listed appState overrides; viewBackgroundColor here wins over background_color."),
    files: z.record(z.string(), z.unknown()).optional().describe("Binary files map (image data), keyed by file id, matching an 'image' element's fileId."),
    render: z.boolean().default(true).describe("Render a PNG of the new drawing and return it alongside the confirmation (the render->look->fix loop)."),
    render_scale: z.number().positive().optional().describe("Zoom factor for the render, when render is true."),
  })
  .strict()
  .superRefine((value, ctx) => exactlyOneAuthoringInput(value, ctx, "excalidash_create_diagram"));
export type CreateDiagramInput = z.infer<typeof CreateDiagramInputSchema>;

// ---------------------------------------------------------------------------
// 2.5 excalidash_edit_diagram
// ---------------------------------------------------------------------------
const AddOpSchema = z.object({ action: z.literal("add"), ...AuthoringInputShape }).strict();

const UpdateOpSchema = z
  .object({
    action: z.literal("update"),
    id: z.string().min(1).describe("Id of the element to patch (a node, an edge/arrow, or any other existing element id)."),
    patch: z.record(z.string(), z.unknown()).describe("Fields to merge onto the element. 'id'/'type' are ignored if present — identity can't change via patch."),
  })
  .strict();

const DeleteOpSchema = z
  .object({
    action: z.literal("delete"),
    ids: z.array(z.string().min(1)).min(1).describe("Element ids to remove. Deleting a node also removes its bound label text."),
  })
  .strict();

const ReplaceAllOpSchema = z.object({ action: z.literal("replace_all"), ...AuthoringInputShape }).strict();

/**
 * `z.discriminatedUnion` requires plain `ZodObject` members (not the
 * `ZodEffects` a `.superRefine()` would produce), so the "exactly one of
 * spec/skeleton/elements" check for `add`/`replace_all` ops is applied once,
 * below, over the whole `ops` array — where each issue can still be pinned to
 * its own `ops[i]` path — rather than per-branch here.
 */
export const EditOpSchema = z.discriminatedUnion("action", [AddOpSchema, UpdateOpSchema, DeleteOpSchema, ReplaceAllOpSchema]);
export type EditOp = z.infer<typeof EditOpSchema>;

const EditOpsArraySchema = z
  .array(EditOpSchema)
  .min(1)
  .superRefine((ops, ctx) => {
    ops.forEach((op, index) => {
      if (op.action === "add" || op.action === "replace_all") {
        exactlyOneAuthoringInput(op, ctx, `ops[${index}] (${op.action})`, [index]);
      }
    });
  })
  .describe(
    "Declarative edits applied in order: add (spec/skeleton/elements), update (patch by id), delete (by ids), or replace_all " +
      "(spec/skeleton/elements; must be the only op in the list — it discards the rest of the scene). Re-applied once on a version conflict.",
  );

export const EditDiagramInputSchema = z
  .object({
    drawing_id: DrawingIdSchema,
    expected_version: z
      .number()
      .int()
      .optional()
      .describe("Version you last saw (from get_drawing/a prior edit). If the drawing has moved on since, the edit is refused instead of silently applied on top of unseen changes."),
    ops: EditOpsArraySchema,
    relayout: z
      .boolean()
      .default(false)
      .describe(
        "Re-run auto-layout over the whole (post-ops) scene. Only supported for scenes built entirely from rectangle/ellipse/diamond " +
          "nodes and arrow edges (plus their bound labels) — i.e. DiagramSpec-shaped scenes; fails actionably otherwise.",
      ),
    snapshot_first: z.boolean().default(false).describe("Duplicate the drawing before editing, as cheap insurance against a bad edit (the backend also auto-snapshots)."),
    app_state: AllowedAppStateSchema.optional().describe("Additional allow-listed appState overrides to apply alongside the ops."),
    render: z.boolean().default(true).describe("Render a PNG of the edited drawing and return it alongside the confirmation."),
    render_scale: z.number().positive().optional().describe("Zoom factor for the render, when render is true."),
  })
  .strict();
export type EditDiagramInput = z.infer<typeof EditDiagramInputSchema>;

// ---------------------------------------------------------------------------
// 2.6 excalidash_manage_drawing
// ---------------------------------------------------------------------------
export const ManageDrawingInputSchema = z
  .object({
    drawing_id: DrawingIdSchema,
    action: z
      .enum(["rename", "move", "duplicate", "delete", "list_history", "restore"])
      .describe(
        "rename (needs new_name) / move (needs collection_id, or null to uncategorize) / duplicate / " +
          "delete (single drawing, irreversible) / list_history (snapshots, 48h retention) / restore (needs snapshot_id).",
      ),
    new_name: z.string().min(1).optional().describe("Required for action 'rename'."),
    collection_id: z.string().nullable().optional().describe("Required for action 'move' (null moves it to uncategorized)."),
    snapshot_id: z.string().optional().describe("Required for action 'restore'; get one from action 'list_history'."),
  })
  .strict();
export type ManageDrawingInput = z.infer<typeof ManageDrawingInputSchema>;

// ---------------------------------------------------------------------------
// 2.7 excalidash_collections
// ---------------------------------------------------------------------------
export const CollectionsInputSchema = z
  .object({
    action: z.enum(["list", "create", "rename", "delete"]).describe("list (all your + shared collections) / create / rename / delete."),
    collection_id: z.string().optional().describe("Required for 'rename'/'delete'."),
    name: z.string().min(1).max(100).optional().describe("Required for 'create'/'rename' (1-100 chars)."),
    response_format: ResponseFormatSchema,
  })
  .strict();
export type CollectionsInput = z.infer<typeof CollectionsInputSchema>;

// ---------------------------------------------------------------------------
// 2.8 excalidash_guide
// ---------------------------------------------------------------------------
export const GuideInputSchema = z
  .object({
    topic: z
      .enum(["schema", "style", "layout", "examples", "all"])
      .default("all")
      .describe("Which reference doc to return: element schema, color/style guide, layout recipes, worked examples, or all of them."),
  })
  .strict();
export type GuideInput = z.infer<typeof GuideInputSchema>;
