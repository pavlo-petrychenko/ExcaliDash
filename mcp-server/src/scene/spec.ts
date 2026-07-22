/**
 * `DiagramSpec` → `ExcalidrawElementSkeleton[]` (plan §4.4): the ergonomic-default
 * authoring path. Node/edge objects become container/arrow skeleton entries
 * (`role`/`color`/`shape` resolve to a curated background color; edges bind by node
 * **id**, never by hand-wired index/binding — plan §4.4's `Never invent fractional
 * index strings or hand-wire bindings` rule), `layout.ts` computes every node's
 * `(x, y)`, same-named `frame` values become frame skeleton entries (the library
 * itself auto-sizes a frame from its children's bounds — research 07 §2.6/§3 — so
 * this module deliberately does not compute frame geometry), and an optional
 * `title` becomes a centered heading placed above the laid-out bounds.
 *
 * The returned skeleton is NOT yet normalized/validated — callers pass it through
 * `scene/normalize.ts`'s `normalizeSkeleton()` (the one choke point, T4) before it's
 * persisted or rendered.
 */
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_LABEL_FONT_SIZE,
  DEFAULT_NODE_WIDTH,
  ROLE_PALETTE,
  SHAPE_DEFAULT_ROLE,
  TITLE_FONT_SIZE,
  TITLE_GAP,
} from "../constants.js";
import type { DiagramEdge, DiagramNode, DiagramSpec } from "../schemas/spec.js";
import type { ExcalidrawElementSkeleton } from "./excalidrawVendor.js";
import { computeLayout, type LayoutEdgeInput, type LayoutNodeInput, type LayoutPosition } from "./layout.js";
import { computeArrowGeometry, type RectGeometry } from "./normalize.js";
import { estimateTextWidth } from "./textMetrics.js";

/** Unitless line-height excalidraw assigns to its default font (fontFamily 5, Excalifont) — see `normalize.ts`. */
const DEFAULT_FONT_LINE_HEIGHT = 1.25;

/** Thrown for structurally invalid `DiagramSpec` input that zod's shape validation can't catch (duplicate/unknown ids). */
export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

export interface SpecConversionResult {
  skeleton: ExcalidrawElementSkeleton[];
}

/** Converts a validated `DiagramSpec` into a laid-out skeleton. Throws `SpecError`/`LayoutError` for invalid input. */
export function specToSkeleton(spec: DiagramSpec): SpecConversionResult {
  validateUniqueNodeIds(spec.nodes);
  validateEdgeEndpoints(spec.nodes, spec.edges);

  const dimensionsById = new Map(spec.nodes.map((node) => [node.id, nodeDimensions(node)] as const));
  const layoutNodes: LayoutNodeInput[] = spec.nodes.map((node) => ({
    id: node.id,
    ...dimensionsById.get(node.id)!,
    group: node.group,
    x: node.x,
    y: node.y,
  }));
  const layoutEdges: LayoutEdgeInput[] = spec.edges.map((edge) => ({ from: edge.from, to: edge.to }));
  const positions = computeLayout(layoutNodes, layoutEdges, spec.layout);

  const nodeSkeletons = spec.nodes.map((node) => nodeToSkeleton(node, positions.get(node.id)!, dimensionsById.get(node.id)!));
  const geometryById = new Map<string, RectGeometry>(
    spec.nodes.map((node) => {
      const position = positions.get(node.id)!;
      const dimensions = dimensionsById.get(node.id)!;
      return [node.id, { x: position.x, y: position.y, ...dimensions }];
    }),
  );
  const edgeSkeletons = spec.edges.map((edge) => edgeToSkeleton(edge, geometryById));
  const frameSkeletons = buildFrameSkeletons(spec.nodes);
  const titleSkeleton = spec.title
    ? [buildTitleSkeleton(spec.title, spec.nodes, positions, dimensionsById)]
    : [];

  return { skeleton: [...nodeSkeletons, ...edgeSkeletons, ...frameSkeletons, ...titleSkeleton] };
}

function nodeDimensions(node: DiagramNode): { width: number; height: number } {
  return { width: node.width ?? DEFAULT_NODE_WIDTH, height: node.height ?? DEFAULT_NODE_HEIGHT };
}

function validateUniqueNodeIds(nodes: readonly DiagramNode[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) duplicates.add(node.id);
    seen.add(node.id);
  }
  if (duplicates.size > 0) {
    throw new SpecError(`DiagramSpec has duplicate node id(s): [${[...duplicates].join(", ")}]. Node ids must be unique.`);
  }
}

function validateEdgeEndpoints(nodes: readonly DiagramNode[], edges: readonly DiagramEdge[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  const idsPreview = [...ids].slice(0, 20);
  const previewSuffix = ids.size > idsPreview.length ? ", ..." : "";
  for (const edge of edges) {
    for (const [end, id] of [
      ["from", edge.from],
      ["to", edge.to],
    ] as const) {
      if (!ids.has(id)) {
        throw new SpecError(
          `DiagramSpec edge references unknown ${end} node '${id}'. Valid node ids: [${idsPreview.join(", ")}${previewSuffix}].`,
        );
      }
    }
  }
}

function resolveNodeColor(node: DiagramNode): string {
  if (node.color) return node.color;
  const role = node.role ?? SHAPE_DEFAULT_ROLE[node.shape];
  return ROLE_PALETTE[role];
}

function nodeToSkeleton(
  node: DiagramNode,
  position: LayoutPosition,
  dimensions: { width: number; height: number },
): ExcalidrawElementSkeleton {
  return {
    type: node.shape,
    id: node.id,
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: dimensions.height,
    roundness: { type: 3 },
    backgroundColor: resolveNodeColor(node),
    label: { text: node.label, fontSize: DEFAULT_NODE_LABEL_FONT_SIZE },
  } as ExcalidrawElementSkeleton;
}

/**
 * `x`/`y`/`points` are computed from the laid-out node geometry (`computeArrowGeometry`, shared
 * with `normalize.ts`'s degenerate-arrow repair) so the arrow actually spans source→target instead
 * of sitting at the skeleton's x:0,y:0 default with a fixed short segment — the id `start`/`end`
 * bindings are kept regardless so reciprocal `boundElements` still get wired by
 * `convertToExcalidrawElements`.
 */
function edgeToSkeleton(edge: DiagramEdge, geometryById: ReadonlyMap<string, RectGeometry>): ExcalidrawElementSkeleton {
  const { x, y, points } = computeArrowGeometry(geometryById.get(edge.from)!, geometryById.get(edge.to)!);
  return {
    type: "arrow",
    x,
    y,
    points,
    start: { id: edge.from },
    end: { id: edge.to },
    strokeStyle: edge.style,
    startArrowhead: null,
    endArrowhead: edge.arrowhead === "none" ? null : edge.arrowhead,
    ...(edge.label ? { label: { text: edge.label } } : {}),
  } as ExcalidrawElementSkeleton;
}

/** Groups nodes by their (optional) `frame` name; the library auto-sizes each frame from its children's bounds. */
function buildFrameSkeletons(nodes: readonly DiagramNode[]): ExcalidrawElementSkeleton[] {
  const childrenByFrameName = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.frame) continue;
    if (!childrenByFrameName.has(node.frame)) childrenByFrameName.set(node.frame, []);
    childrenByFrameName.get(node.frame)!.push(node.id);
  }
  return [...childrenByFrameName.entries()].map(
    ([name, children]) => ({ type: "frame", name, children } as ExcalidrawElementSkeleton),
  );
}

function buildTitleSkeleton(
  title: string,
  nodes: readonly DiagramNode[],
  positions: ReadonlyMap<string, LayoutPosition>,
  dimensionsById: ReadonlyMap<string, { width: number; height: number }>,
): ExcalidrawElementSkeleton {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const node of nodes) {
    const position = positions.get(node.id)!;
    const { width } = dimensionsById.get(node.id)!;
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x + width);
    minY = Math.min(minY, position.y);
  }

  const estimatedWidth = estimateTextWidth(title, TITLE_FONT_SIZE);
  const estimatedHeight = TITLE_FONT_SIZE * DEFAULT_FONT_LINE_HEIGHT;
  return {
    type: "text",
    text: title,
    fontSize: TITLE_FONT_SIZE,
    x: (minX + maxX) / 2 - estimatedWidth / 2,
    y: minY - TITLE_GAP - estimatedHeight,
  } as ExcalidrawElementSkeleton;
}
