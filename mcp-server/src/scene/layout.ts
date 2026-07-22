/**
 * Auto-layout (plan §4.5): "makes a mediocre agent look good" by turning a
 * `DiagramSpec`'s `nodes`/`edges`/`layout` into an `(x, y)` per node id, written
 * back onto the skeleton by `scene/spec.ts` before it reaches
 * `convertToExcalidrawElements`. Three strategies, selected by `layout.type`:
 *
 * - **flow**: treats nodes+edges as a DAG. Ranks are assigned by longest path
 *   from root nodes (no incoming edge); cycles are broken by ignoring
 *   "back-edges" (an edge to a node already on the current DFS path) purely for
 *   ranking purposes — the edge is still drawn, just not used to push its
 *   target to a later rank. Within a rank, one barycenter pass orders nodes by
 *   the average position of their same-`group`-agnostic predecessors in the
 *   previous rank (falls back to input order when a node has none there), then
 *   a stable group-sort clusters same-`group` nodes together (plan: "pragmatic:
 *   sort within rank by group"). Ranks stack along `direction` ("down" = rows,
 *   "right" = columns); both the within-rank and between-rank offsets are
 *   computed from actual node width/height (not a fixed slot size), which is
 *   what guarantees the no-overlap invariant even when nodes have custom sizes.
 * - **grid**: `ceil(sqrt(n))` columns, row-major, grouped nodes clustered by a
 *   stable pre-sort; column widths / row heights sized from the actual nodes
 *   placed in them, same no-overlap reasoning as flow.
 * - **manual**: every node must already carry `x`/`y` (validated here, not by
 *   zod — see `schemas/spec.ts`'s header comment); positions pass through
 *   unchanged, so overlap is the caller's responsibility.
 *
 * Deterministic given input order: no randomness, no `Date.now()`, no reliance
 * on object/Map iteration order beyond what's explicitly constructed from the
 * input arrays.
 */
import type { LayoutDirection, LayoutType } from "../schemas/spec.js";

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
  group?: string;
  /** Only read/required when `type === "manual"`. */
  x?: number;
  y?: number;
}

export interface LayoutEdgeInput {
  from: string;
  to: string;
}

export interface LayoutOptions {
  type: LayoutType;
  direction: LayoutDirection;
  spacingX: number;
  spacingY: number;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

/** Thrown for structurally invalid layout input (unknown edge endpoints, missing manual coords). */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

/** Computes a position for every node id. Throws `LayoutError` on invalid input. */
export function computeLayout(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
  options: LayoutOptions,
): Map<string, LayoutPosition> {
  const knownIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!knownIds.has(edge.from)) throw new LayoutError(`Layout edge references unknown node '${edge.from}'.`);
    if (!knownIds.has(edge.to)) throw new LayoutError(`Layout edge references unknown node '${edge.to}'.`);
  }

  switch (options.type) {
    case "manual":
      return computeManualLayout(nodes);
    case "grid":
      return computeGridLayout(nodes, options);
    case "flow":
    default:
      return computeFlowLayout(nodes, edges, options);
  }
}

function computeManualLayout(nodes: readonly LayoutNodeInput[]): Map<string, LayoutPosition> {
  const missing = nodes.filter((node) => node.x === undefined || node.y === undefined).map((node) => node.id);
  if (missing.length > 0) {
    throw new LayoutError(
      `layout.type is 'manual' but node(s) [${missing.join(", ")}] are missing x/y. ` +
        "Set x and y on every node, or use layout.type 'flow'/'grid' instead.",
    );
  }
  const positions = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    positions.set(node.id, { x: node.x!, y: node.y! });
  }
  return positions;
}

function computeGridLayout(nodes: readonly LayoutNodeInput[], options: LayoutOptions): Map<string, LayoutPosition> {
  const ordered = stableGroupSort(nodes);
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));

  const cellOf = new Map<string, { row: number; column: number }>();
  ordered.forEach((node, index) => {
    cellOf.set(node.id, { row: Math.floor(index / columnCount), column: index % columnCount });
  });

  const columnWidths = new Map<number, number>();
  const rowHeights = new Map<number, number>();
  for (const node of ordered) {
    const { row, column } = cellOf.get(node.id)!;
    columnWidths.set(column, Math.max(columnWidths.get(column) ?? 0, node.width));
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, node.height));
  }

  const columnOffsets = cumulativeOffsets(columnWidths, options.spacingX);
  const rowOffsets = cumulativeOffsets(rowHeights, options.spacingY);

  const positions = new Map<string, LayoutPosition>();
  for (const node of ordered) {
    const { row, column } = cellOf.get(node.id)!;
    positions.set(node.id, { x: columnOffsets.get(column)!, y: rowOffsets.get(row)! });
  }
  return positions;
}

/** `offsetForIndex(i)` = sum of `sizeByIndex[0..i-1]` each plus `gap`, i.e. where index `i` starts. */
function cumulativeOffsets(sizeByIndex: ReadonlyMap<number, number>, gap: number): Map<number, number> {
  const indices = [...sizeByIndex.keys()].sort((a, b) => a - b);
  const offsets = new Map<number, number>();
  let cursor = 0;
  for (const index of indices) {
    offsets.set(index, cursor);
    cursor += sizeByIndex.get(index)! + gap;
  }
  return offsets;
}

/** Stable sort by `group` (nodes without a group share the empty-string key and keep relative order). */
function stableGroupSort(nodes: readonly LayoutNodeInput[]): LayoutNodeInput[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const groupCompare = (a.node.group ?? "").localeCompare(b.node.group ?? "");
      return groupCompare !== 0 ? groupCompare : a.index - b.index;
    })
    .map((entry) => entry.node);
}

function computeFlowLayout(
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
  options: LayoutOptions,
): Map<string, LayoutPosition> {
  const order = nodes.map((node) => node.id);
  const forward = new Map<string, string[]>(order.map((id) => [id, []]));
  for (const edge of edges) forward.get(edge.from)!.push(edge.to);

  const { topoOrder, backEdges } = topologicalOrderIgnoringCycles(order, forward);
  const rank = computeLongestPathRanks(topoOrder, forward, backEdges);

  const byRank = new Map<number, string[]>();
  for (const id of order) {
    const r = rank.get(id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(id);
  }

  const predecessors = new Map<string, string[]>();
  for (const [u, targets] of forward) {
    for (const v of targets) {
      if (!predecessors.has(v)) predecessors.set(v, []);
      predecessors.get(v)!.push(u);
    }
  }
  applyBarycenterPass(byRank, predecessors);
  applyGroupClustering(byRank, nodes);

  return placeRanks(byRank, nodes, options);
}

/**
 * DFS-based topological order over `order` (processed in that sequence so ties
 * resolve deterministically), returning post-order reversed plus the set of
 * back-edges (edges to a node currently on the DFS stack, i.e. a cycle-closing
 * edge) — those are excluded from rank propagation but not from the drawn scene.
 */
function topologicalOrderIgnoringCycles(
  order: readonly string[],
  forward: ReadonlyMap<string, string[]>,
): { topoOrder: string[]; backEdges: Set<string> } {
  const backEdges = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const postOrder: string[] = [];

  function visit(id: string): void {
    visiting.add(id);
    for (const next of forward.get(id) ?? []) {
      if (visiting.has(next)) {
        backEdges.add(edgeKey(id, next));
        continue;
      }
      if (!visited.has(next)) visit(next);
    }
    visiting.delete(id);
    visited.add(id);
    postOrder.push(id);
  }

  for (const id of order) {
    if (!visited.has(id)) visit(id);
  }
  return { topoOrder: postOrder.reverse(), backEdges };
}

function computeLongestPathRanks(
  topoOrder: readonly string[],
  forward: ReadonlyMap<string, string[]>,
  backEdges: ReadonlySet<string>,
): Map<string, number> {
  const rank = new Map<string, number>(topoOrder.map((id) => [id, 0]));
  for (const u of topoOrder) {
    for (const v of forward.get(u) ?? []) {
      if (backEdges.has(edgeKey(u, v))) continue;
      const candidate = rank.get(u)! + 1;
      if (candidate > rank.get(v)!) rank.set(v, candidate);
    }
  }
  return rank;
}

function edgeKey(from: string, to: string): string {
  return `${from} ${to}`;
}

/** One barycenter ordering pass, rank by rank in increasing order (plan §4.5). */
function applyBarycenterPass(byRank: Map<number, string[]>, predecessors: ReadonlyMap<string, string[]>): void {
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  if (ranks.length === 0) return;

  const positionOf = new Map<string, number>();
  byRank.get(ranks[0]!)!.forEach((id, index) => positionOf.set(id, index));

  for (let i = 1; i < ranks.length; i++) {
    const rankValue = ranks[i]!;
    const nodesInRank = byRank.get(rankValue)!;
    const originalIndex = new Map(nodesInRank.map((id, index) => [id, index] as const));
    const scored = nodesInRank.map((id) => {
      const preds = (predecessors.get(id) ?? []).filter((p) => positionOf.has(p));
      const score =
        preds.length > 0
          ? preds.reduce((sum, p) => sum + positionOf.get(p)!, 0) / preds.length
          : originalIndex.get(id)!;
      return { id, score, index: originalIndex.get(id)! };
    });
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    const ordered = scored.map((entry) => entry.id);
    byRank.set(rankValue, ordered);
    ordered.forEach((id, index) => positionOf.set(id, index));
  }
}

/** Stable-sorts each rank's node list by `group` so same-group nodes end up adjacent. */
function applyGroupClustering(byRank: Map<number, string[]>, nodes: readonly LayoutNodeInput[]): void {
  const groupOf = new Map(nodes.map((node) => [node.id, node.group ?? ""] as const));
  for (const [rankValue, ids] of byRank) {
    const clustered = ids
      .map((id, index) => ({ id, index }))
      .sort((a, b) => {
        const groupCompare = groupOf.get(a.id)!.localeCompare(groupOf.get(b.id)!);
        return groupCompare !== 0 ? groupCompare : a.index - b.index;
      })
      .map((entry) => entry.id);
    byRank.set(rankValue, clustered);
  }
}

function placeRanks(
  byRank: ReadonlyMap<number, string[]>,
  nodes: readonly LayoutNodeInput[],
  options: LayoutOptions,
): Map<string, LayoutPosition> {
  const dims = new Map(nodes.map((node) => [node.id, node] as const));
  const ranks = [...byRank.keys()].sort((a, b) => a - b);

  // Thickness each rank occupies along the *main* axis (the axis ranks stack
  // along: y when direction is "down", x when "right") — the max over that
  // rank's nodes' size on that same axis.
  const mainAxisThicknessPerRank = new Map<number, number>();
  for (const rankValue of ranks) {
    const ids = byRank.get(rankValue)!;
    const maxThickness = Math.max(...ids.map((id) => mainAxisThickness(dims.get(id)!, options.direction)));
    mainAxisThicknessPerRank.set(rankValue, maxThickness);
  }
  const mainOffsetForRank = cumulativeOffsets(mainAxisThicknessPerRank, mainGap(options));

  const positions = new Map<string, LayoutPosition>();
  for (const rankValue of ranks) {
    const ids = byRank.get(rankValue)!;
    let crossCursor = 0;
    const mainOffset = mainOffsetForRank.get(rankValue)!;
    for (const id of ids) {
      const node = dims.get(id)!;
      positions.set(id, direction(options.direction, mainOffset, crossCursor));
      crossCursor += withinRankSize(node, options.direction) + crossGap(options);
    }
  }
  return positions;
}

function mainAxisThickness(node: LayoutNodeInput, direction: LayoutDirection): number {
  return direction === "down" ? node.height : node.width;
}

function withinRankSize(node: LayoutNodeInput, direction: LayoutDirection): number {
  return direction === "down" ? node.width : node.height;
}

function mainGap(options: LayoutOptions): number {
  return options.direction === "down" ? options.spacingY : options.spacingX;
}

function crossGap(options: LayoutOptions): number {
  return options.direction === "down" ? options.spacingX : options.spacingY;
}

function direction(dir: LayoutDirection, mainOffset: number, crossCursor: number): LayoutPosition {
  return dir === "down" ? { x: crossCursor, y: mainOffset } : { x: mainOffset, y: crossCursor };
}
