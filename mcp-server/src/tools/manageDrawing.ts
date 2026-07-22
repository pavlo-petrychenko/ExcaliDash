/**
 * `excalidash_manage_drawing` (plan §2.6): folds rename/move/duplicate/delete/
 * list_history/restore into one tool (plan §0.2 #5's "fewer, higher-leverage
 * tools"). `delete`/`restore` are `destructiveHint:true`; `delete` is always a
 * single drawing_id (no bulk/wildcard). No new API-key scope — history/restore
 * map onto the existing `drawings:read`/`drawings:write` (plan §0.2 #2, T1).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../api/client.js";
import {
  deleteDrawing,
  duplicateDrawing,
  listDrawingHistory,
  restoreDrawingSnapshot,
  updateDrawing,
} from "../api/drawings.js";
import { ManageDrawingInputSchema, type ManageDrawingInput } from "../schemas/tools.js";
import { formatRelativeTime, idWithName, runTool, textResult, ToolInputError } from "./shared.js";

export function registerManageDrawingTool(server: McpServer): void {
  server.registerTool(
    "excalidash_manage_drawing",
    {
      title: "Rename, move, duplicate, delete, or restore a drawing",
      description:
        "One tool for drawing lifecycle actions: rename (needs new_name), move to a collection (needs collection_id, " +
        "or null to uncategorize), duplicate (safety copy), delete (single drawing, irreversible via this tool — the " +
        "backend keeps a 48h snapshot regardless), list_history (snapshots from the last 48h), and restore (needs " +
        "snapshot_id from list_history; overwrites the live drawing).",
      inputSchema: ManageDrawingInputSchema,
      // MCP tool annotations are static per-tool, not per-call — since this one tool's `action` can be
      // `delete`/`restore` (destructive) or `duplicate` (not idempotent: calling it twice makes two
      // copies), the annotations reflect the worst case across all six actions rather than any one of them.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    runTool(async (input: ManageDrawingInput, client) => {
      switch (input.action) {
        case "rename":
          return textResult(await rename(client, input));
        case "move":
          return textResult(await move(client, input));
        case "duplicate":
          return textResult(await duplicate(client, input));
        case "delete":
          return textResult(await remove(client, input));
        case "list_history":
          return textResult(await listHistory(client, input));
        case "restore":
          return textResult(await restore(client, input));
      }
    }),
  );
}

async function rename(client: ApiClient, input: ManageDrawingInput): Promise<string> {
  if (!input.new_name) throw new ToolInputError("action:'rename' requires new_name.");
  const drawing = await updateDrawing(client, input.drawing_id, { name: input.new_name });
  return `Renamed to ${idWithName(drawing.id, drawing.name)}.`;
}

async function move(client: ApiClient, input: ManageDrawingInput): Promise<string> {
  if (input.collection_id === undefined) {
    throw new ToolInputError("action:'move' requires collection_id (or null to uncategorize).");
  }
  const drawing = await updateDrawing(client, input.drawing_id, { collectionId: input.collection_id });
  return input.collection_id
    ? `Moved ${idWithName(drawing.id, drawing.name)} to collection ${input.collection_id}.`
    : `Moved ${idWithName(drawing.id, drawing.name)} to uncategorized.`;
}

async function duplicate(client: ApiClient, input: ManageDrawingInput): Promise<string> {
  const copy = await duplicateDrawing(client, input.drawing_id);
  return `Duplicated as ${idWithName(copy.id, copy.name)} (version ${copy.version}).`;
}

async function remove(client: ApiClient, input: ManageDrawingInput): Promise<string> {
  await deleteDrawing(client, input.drawing_id);
  return `Deleted drawing ${input.drawing_id}. This only deletes this one drawing; recover from history within 48h via a different drawing if needed.`;
}

async function listHistory(client: ApiClient, input: ManageDrawingInput): Promise<string> {
  const history = await listDrawingHistory(client, input.drawing_id);
  if (history.snapshots.length === 0) {
    return `No snapshots for ${input.drawing_id} (48h retention — nothing recent, or nothing has changed).`;
  }
  const lines = [`${history.totalCount} snapshot(s) for ${input.drawing_id} (48h retention):`];
  for (const snapshot of history.snapshots) {
    lines.push(`- ${snapshot.id}: version ${snapshot.version}, ${formatRelativeTime(snapshot.createdAt)}`);
  }
  return lines.join("\n");
}

async function restore(client: ApiClient, input: ManageDrawingInput): Promise<string> {
  if (!input.snapshot_id) throw new ToolInputError("action:'restore' requires snapshot_id; call action:'list_history' first.");
  const drawing = await restoreDrawingSnapshot(client, input.drawing_id, input.snapshot_id);
  return `Restored ${idWithName(drawing.id, drawing.name)} from snapshot ${input.snapshot_id}; now version ${drawing.version}.`;
}
