/**
 * The actual full-lifecycle e2e scenario (plan §8 T9 acceptance check):
 * create_diagram(spec, render) -> id+image -> get_drawing summary matches
 * nodes/edges -> render region -> edit add-node+relayout (version bumps) ->
 * manage_drawing list_history -> restore -> collections create + move ->
 * delete; re-fetched scene has valid indices + reciprocal bindings; a
 * drawings:read-only key 403s on writes.
 *
 * Runs against a REAL backend + a REAL built MCP server subprocess (see
 * `mcpClient.mjs`) — every assertion here is checking production code, not a
 * faked `fetch` (that's what `src/tools/*.test.ts` already cover).
 */
import { assert, extractFirstSnapshotId, extractId, hasImageBlock, parseFullViewJson, step, textOf } from "./assertions.mjs";

const SPEC = {
  nodes: [
    { id: "start", label: "Start", shape: "ellipse" },
    { id: "process", label: "Do work" },
    { id: "decision", label: "OK?", shape: "diamond" },
  ],
  edges: [
    { from: "start", to: "process" },
    { from: "process", to: "decision" },
  ],
};

/** `full` and `readOnly` are `mcpClient.mjs` connections for the two seeded API keys. */
export async function runScenario({ full, readOnly }) {
  const drawingId = await step("excalidash_create_diagram(spec, render:true)", () => createDiagram(full));
  await step("excalidash_get_drawing view:summary matches nodes/edges", () => checkSummary(full, drawingId));
  await step("excalidash_render mode:region", () => checkRegionRender(full, drawingId));
  await step("excalidash_edit_diagram add-node + relayout bumps version", () => editAddNodeAndRelayout(full, drawingId));
  await step("re-fetched scene has valid indices + reciprocal bindings", () => checkNormalizedScene(full, drawingId));
  const snapshotId = await step("excalidash_manage_drawing list_history", () => listHistory(full, drawingId));
  await step("excalidash_manage_drawing restore", () => restoreSnapshot(full, drawingId, snapshotId));
  const collectionId = await step("excalidash_collections create", () => createCollection(full));
  await step("excalidash_manage_drawing move", () => moveToCollection(full, drawingId, collectionId));
  await step("excalidash_manage_drawing delete", () => deleteDrawing(full, drawingId));
  await step("excalidash_collections delete (cleanup)", () => deleteCollection(full, collectionId));
  await step("a drawings:read-only key 403s on writes", () => checkReadOnlyKeyRejectsWrites(readOnly));
}

async function createDiagram(client) {
  const result = await client.callTool("excalidash_create_diagram", { name: "E2E Flow", spec: SPEC, render: true });
  assert(!result.isError, `create_diagram failed: ${textOf(result)}`);
  assert(hasImageBlock(result), "create_diagram with render:true did not return an image block");
  return extractId(textOf(result));
}

async function checkSummary(client, drawingId) {
  const result = await client.callTool("excalidash_get_drawing", { drawing_id: drawingId, view: "summary" });
  assert(!result.isError, `get_drawing failed: ${textOf(result)}`);
  const text = textOf(result);
  for (const label of ["Start", "Do work", "OK?"]) {
    assert(text.includes(label), `summary missing node label ${label}: ${text}`);
  }
  for (const edge of ["start -> process", "process -> decision"]) {
    assert(text.includes(edge), `summary missing edge ${edge}: ${text}`);
  }
}

async function checkRegionRender(client, drawingId) {
  const result = await client.callTool("excalidash_render", {
    drawing_id: drawingId,
    mode: "region",
    region: { x: -1000, y: -1000, width: 4000, height: 4000 },
  });
  assert(!result.isError, `render mode:region failed: ${textOf(result)}`);
  assert(hasImageBlock(result), "render mode:region did not return an image block");
}

async function editAddNodeAndRelayout(client, drawingId) {
  const before = await client.callTool("excalidash_get_drawing", { drawing_id: drawingId, view: "summary", response_format: "json" });
  const versionBefore = JSON.parse(textOf(before)).version;

  const result = await client.callTool("excalidash_edit_diagram", {
    drawing_id: drawingId,
    ops: [
      {
        action: "add",
        skeleton: [
          {
            type: "rectangle",
            id: "extra",
            x: 0,
            y: 0,
            width: 180,
            height: 80,
            roundness: { type: 3 },
            backgroundColor: "#eebefa",
            label: { text: "Extra step", fontSize: 20 },
          },
          { type: "arrow", x: 0, y: 0, start: { id: "decision" }, end: { id: "extra" }, endArrowhead: "arrow" },
        ],
      },
    ],
    relayout: true,
    render: true,
  });
  assert(!result.isError, `edit_diagram failed: ${textOf(result)}`);
  assert(hasImageBlock(result), "edit_diagram with render:true did not return an image block");

  const after = await client.callTool("excalidash_get_drawing", { drawing_id: drawingId, view: "summary", response_format: "json" });
  const versionAfter = JSON.parse(textOf(after)).version;
  assert(versionAfter > versionBefore, `expected version to bump (before=${versionBefore}, after=${versionAfter})`);
  return versionAfter;
}

async function checkNormalizedScene(client, drawingId) {
  const result = await client.callTool("excalidash_get_drawing", { drawing_id: drawingId, view: "full", response_format: "json" });
  assert(!result.isError, `get_drawing view:full failed: ${textOf(result)}`);
  const { elements } = parseFullViewJson(textOf(result));

  const live = elements.filter((element) => !element.isDeleted);
  assert(live.length > 0, "expected at least one live element");
  for (const element of live) {
    assert(typeof element.index === "string" && element.index.length > 0, `element ${element.id} has no fractional index`);
  }

  const byId = new Map(live.map((element) => [element.id, element]));
  const extraArrow = live.find((element) => element.type === "arrow" && element.endBinding?.elementId === "extra");
  assert(extraArrow, "expected the new arrow bound to 'extra' in the re-fetched scene");
  assert(extraArrow.startBinding?.elementId === "decision", "new arrow should still start bound to 'decision'");

  const extraNode = byId.get("extra");
  assert(extraNode, "expected node 'extra' in the re-fetched scene");
  const reciprocal = (extraNode.boundElements ?? []).some((bound) => bound.id === extraArrow.id && bound.type === "arrow");
  assert(reciprocal, "'extra' node's boundElements does not reciprocally reference the new arrow");
}

async function listHistory(client, drawingId) {
  const result = await client.callTool("excalidash_manage_drawing", { drawing_id: drawingId, action: "list_history" });
  assert(!result.isError, `list_history failed: ${textOf(result)}`);
  return extractFirstSnapshotId(textOf(result));
}

async function restoreSnapshot(client, drawingId, snapshotId) {
  const result = await client.callTool("excalidash_manage_drawing", { drawing_id: drawingId, action: "restore", snapshot_id: snapshotId });
  assert(!result.isError, `restore failed: ${textOf(result)}`);
  assert(textOf(result).includes("Restored"), `unexpected restore response: ${textOf(result)}`);
}

async function createCollection(client) {
  const result = await client.callTool("excalidash_collections", { action: "create", name: "E2E Collection" });
  assert(!result.isError, `collections create failed: ${textOf(result)}`);
  return extractId(textOf(result));
}

async function moveToCollection(client, drawingId, collectionId) {
  const result = await client.callTool("excalidash_manage_drawing", { drawing_id: drawingId, action: "move", collection_id: collectionId });
  assert(!result.isError, `move failed: ${textOf(result)}`);
  assert(textOf(result).includes("Moved"), `unexpected move response: ${textOf(result)}`);
}

async function deleteDrawing(client, drawingId) {
  const result = await client.callTool("excalidash_manage_drawing", { drawing_id: drawingId, action: "delete" });
  assert(!result.isError, `delete failed: ${textOf(result)}`);
  assert(textOf(result).includes("Deleted"), `unexpected delete response: ${textOf(result)}`);
}

async function deleteCollection(client, collectionId) {
  const result = await client.callTool("excalidash_collections", { action: "delete", collection_id: collectionId });
  assert(!result.isError, `collections delete failed: ${textOf(result)}`);
}

async function checkReadOnlyKeyRejectsWrites(client) {
  const listResult = await client.callTool("excalidash_list_drawings", {});
  assert(!listResult.isError, `read-only key should still be able to list drawings: ${textOf(listResult)}`);

  const createResult = await client.callTool("excalidash_create_diagram", { name: "Should be forbidden", spec: SPEC });
  assert(createResult.isError, "expected create_diagram to fail with a read-only API key");
  assert(
    textOf(createResult).toLowerCase().includes("scope"),
    `expected a scope-related 403 message, got: ${textOf(createResult)}`,
  );
}
