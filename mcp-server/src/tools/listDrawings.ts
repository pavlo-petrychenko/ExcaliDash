/**
 * `excalidash_list_drawings` (plan §2.1): readOnly, idempotent. Lists the
 * caller's own drawings and/or drawings shared with them, paginated, with
 * collection ids resolved to names (06-mcp-best-practices.md §5.3: "never bare
 * UUIDs"). `elementCount` requires the raw `elements` array, so this always
 * requests `includeData:true` from the backend — acceptable here because list
 * pages are small (`limit` caps at `MAX_LIST_LIMIT`, see `constants.ts`) and the
 * backend already caches list responses for ~5s (plan §2.1).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listCollections } from "../api/collections.js";
import type { ApiClient } from "../api/client.js";
import { listDrawings as apiListDrawings, listSharedDrawings, type DrawingSummary } from "../api/drawings.js";
import { buildPaginationEnvelope, type PaginationEnvelope } from "../schemas/common.js";
import { ListDrawingsInputSchema, type ListDrawingsInput } from "../schemas/tools.js";
import { formatRelativeTime, idWithName, jsonText, runTool, textResult } from "./shared.js";

interface ListedDrawing {
  id: string;
  name: string;
  updatedAt: string;
  elementCount: number;
  collection: string | null;
}

export function registerListDrawingsTool(server: McpServer): void {
  server.registerTool(
    "excalidash_list_drawings",
    {
      title: "List ExcaliDash drawings",
      description:
        "Lists drawings you own and/or drawings shared with you, with names, element counts, and collections — never bare " +
        "ids. Call this before any other drawing tool if you don't already have a drawing_id. Paginated; results are " +
        "cached ~5s server-side.",
      inputSchema: ListDrawingsInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    runTool(async (input: ListDrawingsInput, client) => {
      const envelope = await listDrawings(client, input);
      const text = input.response_format === "json" ? jsonText(envelope) : formatMarkdown(envelope, input);
      return textResult(text);
    }),
  );
}

async function listDrawings(client: ApiClient, input: ListDrawingsInput): Promise<PaginationEnvelope<ListedDrawing>> {
  const collectionNameById = await buildCollectionNameMap(client);

  const mineRaw = input.scope === "shared" ? [] : await fetchAll(client, "mine", input);
  const sharedRaw = input.scope === "mine" ? [] : await fetchAll(client, "shared", input);
  const merged = [...mineRaw, ...sharedRaw].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const total = merged.length;
  const page = merged.slice(input.offset, input.offset + input.limit);
  const items = page.map((drawing) => toListedDrawing(drawing, collectionNameById));
  return buildPaginationEnvelope(total, input.offset, items);
}

/** Fetches one scope's drawings with a page generous enough to cover `offset+limit` after client-side merge/sort. */
async function fetchAll(
  client: ApiClient,
  scope: "mine" | "shared",
  input: ListDrawingsInput,
): Promise<DrawingSummary[]> {
  const params = {
    search: input.query,
    collectionId: scope === "mine" ? input.collection_id : undefined,
    includeData: true,
    limit: input.offset + input.limit,
    offset: 0,
    sortField: "updatedAt" as const,
    sortDirection: "desc" as const,
  };
  const response = scope === "mine" ? await apiListDrawings(client, params) : await listSharedDrawings(client, params);
  return response.drawings as DrawingSummary[];
}

async function buildCollectionNameMap(client: ApiClient): Promise<Map<string, string>> {
  try {
    const collections = await listCollections(client);
    return new Map(collections.map((collection) => [collection.id, collection.name] as const));
  } catch {
    // Collection-name resolution is a nice-to-have, not load-bearing; a scope-limited
    // key (drawings:read only, no collections:read) must not break the whole list.
    return new Map();
  }
}

function toListedDrawing(drawing: DrawingSummary, collectionNameById: ReadonlyMap<string, string>): ListedDrawing {
  const elements = (drawing as unknown as { elements?: unknown[] }).elements;
  return {
    id: drawing.id,
    name: drawing.name,
    updatedAt: drawing.updatedAt,
    elementCount: Array.isArray(elements) ? elements.length : 0,
    collection: drawing.collectionId ? collectionNameById.get(drawing.collectionId) ?? drawing.collectionId : null,
  };
}

function formatMarkdown(envelope: PaginationEnvelope<ListedDrawing>, input: ListDrawingsInput): string {
  if (envelope.items.length === 0) {
    return `No drawings found (scope: ${input.scope}${input.query ? `, query: "${input.query}"` : ""}).`;
  }
  const lines = [`${envelope.total} drawing(s) (showing ${envelope.offset + 1}-${envelope.offset + envelope.count}):`, ""];
  for (const item of envelope.items) {
    const collection = item.collection ? ` — ${item.collection}` : "";
    lines.push(`- ${idWithName(item.id, item.name)}: ${item.elementCount} element(s), updated ${formatRelativeTime(item.updatedAt)}${collection}`);
  }
  if (envelope.has_more) {
    lines.push("", `More results available: call again with offset:${envelope.next_offset}.`);
  }
  return lines.join("\n");
}
