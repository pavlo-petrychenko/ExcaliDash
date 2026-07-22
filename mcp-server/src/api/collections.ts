/**
 * Typed `/collections` calls (plan §2.7, 01-api-surface.md §4). All four routes
 * are already API-key reachable under `collections:read`/`collections:write`.
 */
import type { ApiClient } from "./client.js";

export interface CollectionRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  sharedRole?: "view" | "edit" | null;
  isOwner?: boolean;
  isShared?: boolean;
}

/** `GET /collections` — owned collections plus ones shared with the caller. */
export async function listCollections(client: ApiClient): Promise<CollectionRecord[]> {
  return client.request<CollectionRecord[]>("GET", "/collections");
}

/** `POST /collections` — create; name is trimmed/validated server-side (1-100 chars). */
export async function createCollection(client: ApiClient, name: string): Promise<CollectionRecord> {
  return client.request<CollectionRecord>("POST", "/collections", { body: { name } });
}

/** `PUT /collections/:id` — rename; owner-only, rejects the trash sentinel. */
export async function renameCollection(
  client: ApiClient,
  collectionId: string,
  name: string,
): Promise<CollectionRecord> {
  return client.request<CollectionRecord>("PUT", `/collections/${encodeURIComponent(collectionId)}`, {
    body: { name },
  });
}

/** `DELETE /collections/:id` — owner-only; un-collections its drawings, does not delete them. */
export async function deleteCollection(client: ApiClient, collectionId: string): Promise<void> {
  await client.request<unknown>("DELETE", `/collections/${encodeURIComponent(collectionId)}`);
}
