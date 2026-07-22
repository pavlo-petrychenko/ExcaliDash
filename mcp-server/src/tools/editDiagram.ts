/**
 * `excalidash_edit_diagram` (plan §2.5): write, idempotent-by-ops, destructive.
 * Applies declarative `ops` (`scene/ops.ts`) on top of the drawing's current
 * elements and PUTs the *whole* array + version. On a 409 `VERSION_CONFLICT`,
 * `api/drawings.ts`'s `updateDrawingWithVersionRetry` re-reads and re-applies
 * the SAME ops onto the fresh base exactly once — this file's `buildUpdate`
 * closure is what makes that re-application declarative rather than a blind
 * overwrite (plan §5). `expected_version`, if given, is checked against
 * whichever `current` a given attempt actually sees — a stale assertion aborts
 * that attempt without a PUT (see api/drawings.ts's header comment).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../api/client.js";
import { duplicateDrawing, updateDrawingWithVersionRetry, type DrawingRecord, type UpdateDrawingInput } from "../api/drawings.js";
import { ApiError } from "../api/errors.js";
import { DEFAULT_MAX_LONG_SIDE } from "../constants.js";
import { renderDrawing } from "../render/pipeline.js";
import type { ExcalidrawElementSkeleton } from "../scene/excalidrawVendor.js";
import { normalizeElements, type NormalizeResult } from "../scene/normalize.js";
import { applyOps, type SceneOp } from "../scene/ops.js";
import { DEFAULT_RELAYOUT_OPTIONS, relayoutScene } from "../scene/relayout.js";
import { specToSkeleton } from "../scene/spec.js";
import { EditDiagramInputSchema, type EditDiagramInput, type EditOp } from "../schemas/tools.js";
import { idWithName, imageResult, runTool, textResult } from "./shared.js";

export function registerEditDiagramTool(server: McpServer): void {
  server.registerTool(
    "excalidash_edit_diagram",
    {
      title: "Edit an ExcaliDash diagram",
      description:
        "Applies declarative edits (add/update/delete/replace_all) to an existing drawing and PUTs the whole updated " +
        "scene. add/replace_all accept spec/skeleton/elements like excalidash_create_diagram; update patches an " +
        "existing element by id; delete removes by ids (and cascades to bound labels). On a concurrent edit " +
        "(someone else changed the drawing), the same ops are re-applied onto the fresh scene once before giving up. " +
        "Returns the new version plus (by default) a PNG render — look at it before your next edit.",
      inputSchema: EditDiagramInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    runTool(async (input: EditDiagramInput, client) => {
      const snapshotId = input.snapshot_first ? (await duplicateDrawing(client, input.drawing_id)).id : undefined;

      let latestWarnings: string[] = [];
      const result = await updateDrawingWithVersionRetry(client, input.drawing_id, (current) =>
        buildUpdate(input, current, (warnings) => {
          latestWarnings = warnings;
        }),
      );

      const summary = buildSummary(input, result.drawing, result.retried, snapshotId, latestWarnings);
      if (!input.render) return textResult(summary);

      const rendered = await renderDrawing({
        elements: result.drawing.elements,
        files: result.drawing.files,
        appState: result.drawing.appState,
        mode: "full",
        scale: input.render_scale,
        maxLongSide: DEFAULT_MAX_LONG_SIDE,
        background: "white",
      });
      return imageResult(rendered.png, summary);
    }),
  );
}

async function buildUpdate(
  input: EditDiagramInput,
  current: DrawingRecord,
  reportWarnings: (warnings: string[]) => void,
): Promise<UpdateDrawingInput> {
  if (input.expected_version !== undefined && input.expected_version !== current.version) {
    throw new ApiError(
      "conflict",
      `Drawing changed concurrently (someone has it open) — re-read and retry. expected_version was ${input.expected_version}, actual is ${current.version}.`,
      { status: 409, currentVersion: current.version },
    );
  }

  const normalizedCurrent = await normalizeElements(current.elements);
  const sceneOps = input.ops.map(resolveOp);
  let opsResult = await applyOps(normalizedCurrent.elements, sceneOps);

  if (input.relayout) {
    const relayouted = await relayoutScene(opsResult.elements, DEFAULT_RELAYOUT_OPTIONS);
    opsResult = mergeWarnings(relayouted, opsResult.warnings);
  }

  reportWarnings([...normalizedCurrent.warnings, ...opsResult.warnings]);

  return {
    elements: opsResult.elements,
    version: current.version,
    ...(input.app_state ? { appState: { ...current.appState, ...input.app_state } } : {}),
  };
}

function mergeWarnings(result: NormalizeResult, extra: readonly string[]): NormalizeResult {
  return { elements: result.elements, warnings: [...extra, ...result.warnings] };
}

function resolveOp(op: EditOp): SceneOp {
  switch (op.action) {
    case "add":
      return { action: "add", ...resolveAuthoringInput(op) };
    case "update":
      return { action: "update", id: op.id, patch: op.patch };
    case "delete":
      return { action: "delete", ids: op.ids };
    case "replace_all":
      return { action: "replace_all", ...resolveAuthoringInput(op) };
  }
}

function resolveAuthoringInput(op: {
  spec?: Parameters<typeof specToSkeleton>[0];
  skeleton?: unknown[];
  elements?: unknown[];
}): { skeleton: ExcalidrawElementSkeleton[] } | { elements: unknown[] } {
  if (op.spec) return { skeleton: specToSkeleton(op.spec).skeleton };
  if (op.skeleton) return { skeleton: op.skeleton as ExcalidrawElementSkeleton[] };
  return { elements: op.elements! };
}

function buildSummary(
  input: EditDiagramInput,
  drawing: DrawingRecord,
  retried: boolean,
  snapshotId: string | undefined,
  warnings: readonly string[],
): string {
  const lines = [
    `Edited ${idWithName(drawing.id, drawing.name)}, now version ${drawing.version}` +
      `${retried ? " (re-applied once after a concurrent edit)" : ""}.`,
  ];
  if (snapshotId) lines.push(`Snapshot taken before editing: ${snapshotId} (excalidash_manage_drawing action:"restore" to revert).`);
  if (input.relayout) lines.push("Scene was re-laid-out.");
  for (const warning of warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}
