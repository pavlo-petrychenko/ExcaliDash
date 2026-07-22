/**
 * The single choke point every authored/edited scene passes through before it is
 * persisted (plan §4.2, §5): skeletons go through `convertToExcalidrawElements`,
 * raw/merged element arrays go through `restoreElements`, and either path then
 * runs `validateScene()` (§4.3) to turn structural problems into messages an
 * agent can act on — never a stack trace. Nothing outside this file should call
 * `convertToExcalidrawElements`/`restoreElements` directly, and nothing should
 * hand-invent fractional `index` strings or wire up bindings by hand (research
 * 07 §4, §9).
 */
import { MAX_ELEMENTS } from "../constants.js";
import { getExcalidrawCore, type ExcalidrawElementSkeleton, type OrderedExcalidrawElement } from "./excalidrawVendor.js";
import { estimateTextWidth } from "./textMetrics.js";

export interface NormalizeResult {
  elements: OrderedExcalidrawElement[];
  warnings: string[];
}

/** Thrown by `normalizeSkeleton`/`normalizeElements` when `validateScene` reports errors. */
export class SceneValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "SceneValidationError";
    this.errors = errors;
  }
}

/**
 * Builds a scene from an `ExcalidrawElementSkeleton[]` (the shape both `spec.ts`
 * (DiagramSpec, T5) and power-user "skeleton" tool input produce). This is the
 * mechanism that auto-wires container labels, arrow bindings, and fractional
 * indices — research 07 §3.2.
 */
export async function normalizeSkeleton(skeleton: ExcalidrawElementSkeleton[]): Promise<NormalizeResult> {
  const core = await getExcalidrawCore();
  const elements = core.convertToExcalidrawElements(repairDegenerateArrowGeometry(skeleton), { regenerateIds: false });
  return finalize(elements);
}

export interface RectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes an arrow's `x`/`y`/`points` (skeleton format: `points` are relative to `x`/`y`) so it
 * visually spans from `from`'s border toward `to`'s border along the straight line between their
 * centers. Shared by `spec.ts` (fresh layout, exact node geometry known up front) and this
 * module's `repairDegenerateArrowGeometry` below (agent-authored/relayout skeletons that bind by
 * id but supply no geometry of their own). Without this, a bound arrow's skeleton defaults to
 * x:0,y:0 with a fixed short horizontal segment, so it renders piled up at the scene origin
 * instead of connecting its bound nodes — the bug this function exists to fix.
 */
export function computeArrowGeometry(
  from: RectGeometry,
  to: RectGeometry,
): { x: number; y: number; points: [number, number][] } {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  let dx = toCenter.x - fromCenter.x;
  let dy = toCenter.y - fromCenter.y;
  if (dx === 0 && dy === 0) dx = 1; // same-position fallback: arbitrary direction so points aren't NaN

  const start = borderPoint(fromCenter, from.width / 2, from.height / 2, dx, dy);
  const end = borderPoint(toCenter, to.width / 2, to.height / 2, -dx, -dy);
  return {
    x: start.x,
    y: start.y,
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ],
  };
}

/** The point where a ray from `center` in direction (`dirX`, `dirY`) exits an axis-aligned rectangle of the given half-extents. */
function borderPoint(
  center: { x: number; y: number },
  halfWidth: number,
  halfHeight: number,
  dirX: number,
  dirY: number,
): { x: number; y: number } {
  if (dirX === 0 && dirY === 0) return center;
  const scaleX = dirX !== 0 ? halfWidth / Math.abs(dirX) : Infinity;
  const scaleY = dirY !== 0 ? halfHeight / Math.abs(dirY) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dirX * scale, y: center.y + dirY * scale };
}

interface SkeletonLike {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: unknown;
  start?: { id?: string };
  end?: { id?: string };
}

/**
 * Backfills real `x`/`y`/`points` on skeleton `arrow` entries that bind by id (`start`/`end`) but
 * supply no geometry of their own — see `computeArrowGeometry`'s doc for why that matters. Both
 * `spec.ts`'s edges (already precise; this is a no-op for them) and the raw "skeleton" tool-input
 * path go through here via `normalizeSkeleton`; `ops.ts`'s `add`/`replace_all` skeleton paths call
 * this directly since they build elements outside `normalizeSkeleton`. Never overrides an entry
 * that already carries an explicit `x`/`y`.
 */
export function repairDegenerateArrowGeometry(
  skeleton: readonly ExcalidrawElementSkeleton[],
): ExcalidrawElementSkeleton[] {
  const geometryById = buildGeometryLookup(skeleton);
  return skeleton.map((entry) => resolveDegenerateArrow(entry, geometryById));
}

function buildGeometryLookup(entries: readonly unknown[]): Map<string, RectGeometry> {
  const geometry = new Map<string, RectGeometry>();
  for (const entry of entries) {
    const el = entry as SkeletonLike;
    if (
      typeof el.id === "string" &&
      typeof el.x === "number" &&
      typeof el.y === "number" &&
      typeof el.width === "number" &&
      typeof el.height === "number"
    ) {
      geometry.set(el.id, { x: el.x, y: el.y, width: el.width, height: el.height });
    }
  }
  return geometry;
}

function resolveDegenerateArrow(
  entry: ExcalidrawElementSkeleton,
  geometryById: ReadonlyMap<string, RectGeometry>,
): ExcalidrawElementSkeleton {
  const el = entry as SkeletonLike;
  // `points` (not x/y) is the reliable "has this arrow's shape been explicitly authored?" signal:
  // the buggy shape this repairs (spec.ts's old output, relayout.ts, and how agents commonly write
  // a bind-by-id arrow) sets a placeholder x:0,y:0 *and* omits points — while an arrow with genuine
  // custom geometry always carries its own points. Gating on x/y alone would miss the placeholder-
  // zero case entirely.
  if (el.type !== "arrow" || el.points !== undefined) return entry;
  const from = el.start?.id ? geometryById.get(el.start.id) : undefined;
  const to = el.end?.id ? geometryById.get(el.end.id) : undefined;
  if (!from || !to) return entry;
  return { ...entry, ...computeArrowGeometry(from, to) } as ExcalidrawElementSkeleton;
}

/**
 * Repairs a raw/merged `elements` array (the escape-hatch input path, or an
 * existing scene's elements merged with edits in `ops.ts`) via `restoreElements`
 * with `repairBindings: true`: backfills defaults, regenerates missing
 * `seed`/`versionNonce`, repairs `containerId`/`boundElements`/`startBinding`/
 * `endBinding` reciprocal references, and normalizes fractional indices
 * (research 07 §8; `restoreElements` is the one place `syncInvalidIndices`-style
 * repair happens — that function itself isn't part of the package's public API
 * in 0.18.1, see `excalidrawVendor.ts`).
 */
export async function normalizeElements(elements: unknown[]): Promise<NormalizeResult> {
  const core = await getExcalidrawCore();
  const restored = core.restoreElements(elements as never, null, {
    repairBindings: true,
    refreshDimensions: false,
  });
  return finalize(restored);
}

function finalize(elements: OrderedExcalidrawElement[]): NormalizeResult {
  const { errors, warnings } = validateScene(elements);
  if (errors.length > 0) {
    throw new SceneValidationError(errors);
  }
  return { elements, warnings };
}

export interface ValidationOutcome {
  errors: string[];
  warnings: string[];
}

/** Unitless `lineHeight` excalidraw's own `getLineHeight` assigns per font family (research 07 §6). */
const EXPECTED_LINE_HEIGHT_BY_FONT_FAMILY: Record<number, number> = {
  1: 1.25, // Virgil
  2: 1.15, // Helvetica
  3: 1.2, // Cascadia
  5: 1.25, // Excalifont (default)
  6: 1.35, // Nunito
  7: 1.15, // Lilita One
  8: 1.25, // Comic Shanns
  9: 1.15, // Liberation Sans
};

const BOUND_TEXT_PADDING = 5;

/**
 * Turns structural problems in an already-normalized element array into
 * agent-actionable messages (plan §4.3). Errors abort the mutation; warnings
 * ride along with a successful response. Exported for `ops.ts` to re-validate
 * after applying declarative ops, and for tests.
 */
export function validateScene(elements: readonly OrderedExcalidrawElement[]): ValidationOutcome {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (elements.length > MAX_ELEMENTS) {
    errors.push(`Scene has ${elements.length} elements; max ${MAX_ELEMENTS}. Split into multiple drawings.`);
  }

  const liveIds = new Set(elements.filter((element) => !element.isDeleted).map((element) => element.id));
  const byId = new Map(elements.map((element) => [element.id, element] as const));

  checkFiniteGeometry(elements, errors);
  checkArrowBindings(elements, liveIds, errors);
  checkBindingConsistency(elements, byId, errors, warnings);
  checkTextOverflow(elements, byId, warnings);

  return { errors, warnings };
}

function checkFiniteGeometry(elements: readonly OrderedExcalidrawElement[], errors: string[]): void {
  for (const element of elements) {
    const fields: Array<[string, number]> = [
      ["x", element.x],
      ["y", element.y],
      ["width", element.width],
      ["height", element.height],
      ["angle", element.angle],
    ];
    for (const [field, value] of fields) {
      if (!Number.isFinite(value)) {
        errors.push(`Element '${element.id}' has non-finite ${field} (${String(value)}).`);
      }
    }
  }
}

function checkArrowBindings(
  elements: readonly OrderedExcalidrawElement[],
  liveIds: ReadonlySet<string>,
  errors: string[],
): void {
  const validIdsPreview = [...liveIds].slice(0, 20);
  for (const element of elements) {
    if (element.type !== "arrow" && element.type !== "line") continue;
    if (element.isDeleted) continue;
    for (const [end, binding] of [
      ["start", element.startBinding],
      ["end", element.endBinding],
    ] as const) {
      if (!binding) continue;
      if (!liveIds.has(binding.elementId)) {
        errors.push(
          `Arrow '${element.id}' references missing ${end} node '${binding.elementId}'. ` +
            `Valid node ids: [${validIdsPreview.join(", ")}${liveIds.size > validIdsPreview.length ? ", ..." : ""}].`,
        );
      }
    }
  }
}

function checkBindingConsistency(
  elements: readonly OrderedExcalidrawElement[],
  byId: ReadonlyMap<string, OrderedExcalidrawElement>,
  errors: string[],
  warnings: string[],
): void {
  for (const element of elements) {
    if (element.type === "text" && element.containerId) {
      const container = byId.get(element.containerId);
      if (!container) {
        errors.push(`Text '${element.id}' has containerId '${element.containerId}', which does not exist.`);
        continue;
      }
      const hasBackRef = (container.boundElements ?? []).some(
        (bound) => bound.type === "text" && bound.id === element.id,
      );
      if (!hasBackRef) {
        errors.push(
          `Text '${element.id}' is bound to container '${container.id}' but the container's ` +
            "boundElements does not list it back — a broken binding.",
        );
      }
      const expected = EXPECTED_LINE_HEIGHT_BY_FONT_FAMILY[element.fontFamily];
      if (expected !== undefined && Math.abs(element.lineHeight - expected) > 0.001) {
        warnings.push(
          `Text '${element.id}' uses fontFamily ${element.fontFamily} with lineHeight ` +
            `${element.lineHeight}; expected ${expected} for that family.`,
        );
      }
    }

    // Reciprocal check from the container/shape side: every bound text must point back,
    // and every bound arrow's own start/endBinding must point back to this element too
    // (research 07 §5.3-§5.4 — the #1 source of hand-authored "broken" scenes).
    for (const bound of element.boundElements ?? []) {
      const partner = byId.get(bound.id);
      if (bound.type === "text") {
        if (!partner || partner.type !== "text" || partner.containerId !== element.id) {
          errors.push(
            `Element '${element.id}' lists bound text '${bound.id}' that does not reciprocally ` +
              "point back to it — a broken binding.",
          );
        }
      } else if (bound.type === "arrow") {
        const bindsBack =
          partner &&
          (partner.type === "arrow" || partner.type === "line") &&
          (partner.startBinding?.elementId === element.id || partner.endBinding?.elementId === element.id);
        if (!bindsBack) {
          warnings.push(
            `Element '${element.id}' lists bound arrow '${bound.id}' that does not reciprocally ` +
              "bind back to it.",
          );
        }
      }
    }
  }
}

function checkTextOverflow(
  elements: readonly OrderedExcalidrawElement[],
  byId: ReadonlyMap<string, OrderedExcalidrawElement>,
  warnings: string[],
): void {
  for (const element of elements) {
    if (element.type !== "text" || !element.containerId) continue;
    const container = byId.get(element.containerId);
    if (!container) continue;
    const usableWidth = containerUsableWidth(container) - 2 * BOUND_TEXT_PADDING;
    const estimatedWidth = estimateTextWidth(element.text, element.fontSize);
    if (estimatedWidth > usableWidth) {
      warnings.push(
        `Label '${element.text}' may overflow its box (~${Math.round(estimatedWidth)}px vs ` +
          `${Math.round(usableWidth)}px usable); widen the node or shorten the text.`,
      );
    }
  }
}

/**
 * A bound label's usable width for shape containers (rectangle/ellipse/diamond) is simply the
 * container's own `width` (the box the text wraps inside). An arrow/line "container" is
 * different: its `width`/`height` are just its axis-aligned bbox extent, not the space available
 * along the line for its label (a purely vertical arrow has `width: 0` despite having plenty of
 * room for a short label) — the actual measure is the line's own length.
 */
function containerUsableWidth(container: OrderedExcalidrawElement): number {
  if (container.type === "arrow" || container.type === "line") {
    return Math.hypot(container.width, container.height);
  }
  return container.width;
}
