/**
 * `edit_diagram`'s `relayout:true` (plan §2.5): re-run auto-layout over an
 * already-persisted scene. Scoped deliberately: only scenes built entirely from
 * `rectangle`/`ellipse`/`diamond` nodes and fully-bound `arrow` edges (plus their
 * bound label text) are supported — that's exactly the shape `scene/spec.ts`
 * produces, so relaying-out is "reconstruct the DiagramSpec-equivalent skeleton
 * from the current scene, then run it through the normal spec pipeline again."
 *
 * This is a deliberate simplification, not an oversight: a raw `x`/`y` PATCH on
 * a container does NOT move its bound label text or recompute an arrow's drawn
 * points (that only happens inside `convertToExcalidrawElements`'s binding
 * geometry, which needs the element rebuilt from a skeleton, not patched in
 * place) — see `scene/ops.ts`'s header comment for the same constraint. Frames,
 * images, freedraw, lines, and unbound arrows are therefore rejected with an
 * actionable error rather than silently dropped or left stale.
 *
 * Type narrowing note: every `element.startBinding`/`.endBinding`/`.text`
 * access below happens inside an `if (element.type === "…")` guard in the SAME
 * loop iteration (mirroring `scene/normalize.ts`'s `checkArrowBindings`) — a
 * `.filter()` call does not preserve that narrowing across a discriminated
 * union in TypeScript, so this deliberately avoids "filter into a typed array,
 * then read a variant-only field later" the way it would elsewhere.
 */
import { DEFAULT_LAYOUT_SPACING_X, DEFAULT_LAYOUT_SPACING_Y } from "../constants.js";
import type { LayoutDirection, LayoutType } from "../schemas/spec.js";
import type { ExcalidrawElement, ExcalidrawElementSkeleton, OrderedExcalidrawElement } from "./excalidrawVendor.js";
import { computeLayout, type LayoutEdgeInput, type LayoutNodeInput } from "./layout.js";
import { normalizeSkeleton, type NormalizeResult } from "./normalize.js";

const NODE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

export interface RelayoutOptions {
  type: LayoutType;
  direction: LayoutDirection;
  spacingX: number;
  spacingY: number;
}

export const DEFAULT_RELAYOUT_OPTIONS: RelayoutOptions = {
  type: "flow",
  direction: "down",
  spacingX: DEFAULT_LAYOUT_SPACING_X,
  spacingY: DEFAULT_LAYOUT_SPACING_Y,
};

/** Thrown when the scene contains element types/shapes relayout can't safely rebuild. */
export class RelayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayoutError";
  }
}

interface BoundLabel {
  text: string;
  fontSize: number;
}

interface NodeSpec {
  id: string;
  type: "rectangle" | "ellipse" | "diamond";
  width: number;
  height: number;
  roundness: ExcalidrawElement["roundness"];
  backgroundColor: string;
  strokeColor: string;
  label: BoundLabel | null;
}

/** Rebuilds the whole (live) scene with fresh auto-layout positions. Throws `RelayoutError`/`LayoutError` for unsupported input. */
export async function relayoutScene(
  elements: readonly OrderedExcalidrawElement[],
  options: RelayoutOptions = DEFAULT_RELAYOUT_OPTIONS,
): Promise<NormalizeResult> {
  const live = elements.filter((element) => !element.isDeleted);
  const byId = new Map(live.map((element) => [element.id, element] as const));

  const boundTextIds = collectBoundTextIds(live);

  const nodeSpecs = new Map<string, NodeSpec>();
  for (const element of live) {
    if (element.type !== "rectangle" && element.type !== "ellipse" && element.type !== "diamond") continue;
    nodeSpecs.set(element.id, {
      id: element.id,
      type: element.type,
      width: element.width,
      height: element.height,
      roundness: element.roundness,
      backgroundColor: element.backgroundColor,
      strokeColor: element.strokeColor,
      label: findBoundLabel(element, byId),
    });
  }

  const layoutEdges: LayoutEdgeInput[] = [];
  const arrowSkeletons: ExcalidrawElementSkeleton[] = [];
  const unboundArrowIds: string[] = [];
  for (const element of live) {
    if (element.type !== "arrow") continue;
    if (!element.startBinding || !element.endBinding) {
      unboundArrowIds.push(element.id);
      continue;
    }
    layoutEdges.push({ from: element.startBinding.elementId, to: element.endBinding.elementId });
    const label = findBoundLabel(element, byId);
    arrowSkeletons.push({
      type: "arrow",
      // No x/y here (deliberately): `normalizeSkeleton`'s `repairDegenerateArrowGeometry` backfills
      // real geometry from the just-computed node positions below, keyed by these start/end ids.
      start: { id: element.startBinding.elementId },
      end: { id: element.endBinding.elementId },
      strokeStyle: element.strokeStyle,
      startArrowhead: element.startArrowhead,
      endArrowhead: element.endArrowhead,
      ...(label ? { label: { text: label.text, fontSize: label.fontSize } } : {}),
    } as ExcalidrawElementSkeleton);
  }

  assertFullySupported(live, nodeSpecs, boundTextIds, unboundArrowIds);

  const layoutNodes: LayoutNodeInput[] = [...nodeSpecs.values()].map((spec) => ({
    id: spec.id,
    width: spec.width,
    height: spec.height,
  }));
  const positions = computeLayout(layoutNodes, layoutEdges, options);

  const nodeSkeletons: ExcalidrawElementSkeleton[] = [...nodeSpecs.values()].map((spec) => {
    const position = positions.get(spec.id)!;
    return {
      type: spec.type,
      id: spec.id,
      x: position.x,
      y: position.y,
      width: spec.width,
      height: spec.height,
      roundness: spec.roundness,
      backgroundColor: spec.backgroundColor,
      strokeColor: spec.strokeColor,
      ...(spec.label ? { label: { text: spec.label.text, fontSize: spec.label.fontSize } } : {}),
    } as ExcalidrawElementSkeleton;
  });

  return normalizeSkeleton([...nodeSkeletons, ...arrowSkeletons]);
}

function collectBoundTextIds(live: readonly ExcalidrawElement[]): Set<string> {
  const boundTextIds = new Set<string>();
  for (const element of live) {
    if (!NODE_TYPES.has(element.type) && element.type !== "arrow") continue;
    for (const bound of element.boundElements ?? []) {
      if (bound.type === "text") boundTextIds.add(bound.id);
    }
  }
  return boundTextIds;
}

function assertFullySupported(
  live: readonly ExcalidrawElement[],
  nodeSpecs: ReadonlyMap<string, NodeSpec>,
  boundTextIds: ReadonlySet<string>,
  unboundArrowIds: readonly string[],
): void {
  const other = live.filter(
    (element) =>
      !nodeSpecs.has(element.id) &&
      element.type !== "arrow" &&
      !(element.type === "text" && boundTextIds.has(element.id)),
  );

  if (unboundArrowIds.length === 0 && other.length === 0) return;

  const parts: string[] = [];
  if (unboundArrowIds.length > 0) {
    parts.push(`${unboundArrowIds.length} arrow(s) missing a start/end binding (dangling coordinates, not bound to a node by id)`);
  }
  const unsupportedTypes = [...new Set(other.map((element) => element.type))];
  if (unsupportedTypes.length > 0) {
    parts.push(`unsupported element type(s): [${unsupportedTypes.join(", ")}]`);
  }
  throw new RelayoutError(
    "relayout only supports scenes built entirely from rectangle/ellipse/diamond nodes and id-bound arrow edges " +
      `(plus their bound label text) — found ${parts.join(" and ")}. Omit relayout, or fix those elements first.`,
  );
}

function findBoundLabel(element: ExcalidrawElement, byId: ReadonlyMap<string, ExcalidrawElement>): BoundLabel | null {
  for (const bound of element.boundElements ?? []) {
    if (bound.type !== "text") continue;
    const text = byId.get(bound.id);
    if (text && text.type === "text") return { text: text.text, fontSize: text.fontSize };
  }
  return null;
}
