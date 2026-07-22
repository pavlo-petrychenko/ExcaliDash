/**
 * `excalidash_collections` (plan §2.7): mixed read/write; `delete` is
 * destructive. All four routes are already API-key reachable under
 * `collections:read`/`collections:write` — no backend change needed (plan §3).
 * Assigning a drawing to a collection is `excalidash_manage_drawing
 * action:"move"`, not this tool.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
  type CollectionRecord,
} from "../api/collections.js";
import { CollectionsInputSchema, type CollectionsInput } from "../schemas/tools.js";
import { idWithName, jsonText, runTool, textResult, ToolInputError } from "./shared.js";

export function registerCollectionsTool(server: McpServer): void {
  server.registerTool(
    "excalidash_collections",
    {
      title: "List, create, rename, or delete ExcaliDash collections",
      description:
        "Manages collections (folders for drawings). list returns your own collections plus ones shared with you. " +
        "create/rename need name (1-100 chars); rename/delete need collection_id. Deleting a collection un-files its " +
        "drawings — it does not delete them. To file a drawing into a collection, use excalidash_manage_drawing " +
        "action:'move', not this tool.",
      inputSchema: CollectionsInputSchema,
      // Worst case across the four actions (same reasoning as excalidash_manage_drawing): delete is destructive.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    runTool(async (input: CollectionsInput, client) => {
      switch (input.action) {
        case "list": {
          const collections = await listCollections(client);
          const text = input.response_format === "json" ? jsonText(collections) : formatList(collections);
          return textResult(text);
        }
        case "create": {
          if (!input.name) throw new ToolInputError("action:'create' requires name.");
          const collection = await createCollection(client, input.name);
          return textResult(`Created collection ${idWithName(collection.id, collection.name)}.`);
        }
        case "rename": {
          if (!input.collection_id) throw new ToolInputError("action:'rename' requires collection_id.");
          if (!input.name) throw new ToolInputError("action:'rename' requires name.");
          const collection = await renameCollection(client, input.collection_id, input.name);
          return textResult(`Renamed collection to ${idWithName(collection.id, collection.name)}.`);
        }
        case "delete": {
          if (!input.collection_id) throw new ToolInputError("action:'delete' requires collection_id.");
          await deleteCollection(client, input.collection_id);
          return textResult(`Deleted collection ${input.collection_id}. Its drawings are now uncategorized, not deleted.`);
        }
      }
    }),
  );
}

function formatList(collections: readonly CollectionRecord[]): string {
  if (collections.length === 0) return "No collections yet.";
  const lines = [`${collections.length} collection(s):`];
  for (const collection of collections) {
    const shared = collection.isShared ? " (shared with you)" : "";
    lines.push(`- ${idWithName(collection.id, collection.name)}${shared}`);
  }
  return lines.join("\n");
}
