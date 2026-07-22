/**
 * Declarative element-level edit ops (plan §4.6, §2.5): `add` / `update` /
 * `delete` / `replace_all`, applied on top of a drawing's current elements to
 * produce a new, fully normalized+validated array. Declarative so the exact
 * same op list can be **re-applied onto a freshly-refetched base** after a 409
 * version conflict (plan §5) instead of blind-overwriting.
 *
 * `add` with a `skeleton` runs `convertToExcalidrawElements` over the current
 * elements *plus* the new skeleton entries in one call — this is the only way
 * a new arrow can bind to an *existing* node: `start: { id: "<existingId>" }`
 * silently drops the binding (no error) if the target isn't present in the
 * same `convertToExcalidrawElements` call, because that's what computes the
 * binding geometry.
 *
 * Passing already-formed containers/text through that second call IS safe
 * (their base fields pass through `newElement({ ...element })` untouched) —
 * but already-formed ARROWS are not: `convertToExcalidrawElements` only ever
 * derives `startBinding`/`endBinding` from an input's skeleton-shaped `start`/
 * `end` descriptors, never from an already-computed `startBinding`/`endBinding`
 * (an already-persisted element has the latter, not the former). Re-running an
 * existing bound arrow through it with no `start`/`end` therefore silently
 * clears its binding (`get_drawing`/`validateScene` would then report the
 * arrow's OWN nodes as having dangling `boundElements` — found by T9's e2e,
 * which is the first test to `add` onto a scene with pre-existing bound
 * arrows; the fixture-only unit tests never had one). `withSyntheticEndpoints`
 * below re-derives each old arrow's `start`/`end` from its current
 * `startBinding`/`endBinding` right before the combined call, so the same
 * binding-by-id mechanism that binds a *new* arrow to an existing node also
 * re-affirms an *old* arrow's binding instead of dropping it.
 */
import { getExcalidrawCore, type ExcalidrawElementSkeleton, type OrderedExcalidrawElement } from "./excalidrawVendor.js";
import { normalizeElements, repairDegenerateArrowGeometry, type NormalizeResult } from "./normalize.js";

export type SceneOp =
  | { action: "add"; skeleton: ExcalidrawElementSkeleton[] }
  | { action: "add"; elements: unknown[] }
  | { action: "update"; id: string; patch: Record<string, unknown> }
  | { action: "delete"; ids: string[] }
  | { action: "replace_all"; skeleton: ExcalidrawElementSkeleton[] }
  | { action: "replace_all"; elements: unknown[] };

/** Thrown for structurally invalid op lists (never for scene validation — that's `SceneValidationError`). */
export class OpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsError";
  }
}

/** Fields an `update` patch may never override — identity/type must stay stable. */
const IMMUTABLE_PATCH_FIELDS = new Set(["id", "type"]);

/**
 * Applies a declarative op list on top of `current` and returns the new
 * normalized+validated scene. Throws `OpsError` for malformed op lists and
 * `SceneValidationError` (from `normalize.ts`) if the resulting scene is
 * structurally broken.
 */
export async function applyOps(
  current: readonly OrderedExcalidrawElement[],
  ops: readonly SceneOp[],
): Promise<NormalizeResult> {
  if (ops.length === 0) {
    throw new OpsError("At least one op is required.");
  }

  const replaceAll = ops.find((op) => op.action === "replace_all");
  if (replaceAll) {
    if (ops.length > 1) {
      throw new OpsError("`replace_all` must be the only op in a single edit call — it discards the rest of the scene.");
    }
    return applyReplaceAll(replaceAll);
  }

  let working: unknown[] = current.map((element) => ({ ...element }));
  for (const op of ops) {
    switch (op.action) {
      case "add":
        working = await applyAdd(working, op);
        break;
      case "update":
        working = applyUpdate(working, op);
        break;
      case "delete":
        working = applyDelete(working, op);
        break;
      default:
        throw new OpsError(`Unknown op action: ${(op as { action: string }).action}`);
    }
  }

  return normalizeElements(working);
}

async function applyReplaceAll(op: Extract<SceneOp, { action: "replace_all" }>): Promise<NormalizeResult> {
  if ("skeleton" in op) {
    const core = await getExcalidrawCore();
    const elements = core.convertToExcalidrawElements(repairDegenerateArrowGeometry(op.skeleton), { regenerateIds: false });
    return normalizeElements(elements);
  }
  return normalizeElements(op.elements);
}

async function applyAdd(working: unknown[], op: Extract<SceneOp, { action: "add" }>): Promise<unknown[]> {
  if ("skeleton" in op) {
    const core = await getExcalidrawCore();
    // Pass the current scene through as context (see module doc) so a new
    // arrow can bind to an id already in `working`, not just to other ids
    // introduced by this same op. `withSyntheticEndpoints` re-derives each
    // already-persisted arrow's `start`/`end` from its current binding first
    // (see module doc) so this re-run reaffirms old bindings instead of
    // silently dropping them.
    const combined = [...withSyntheticEndpoints(working), ...op.skeleton] as ExcalidrawElementSkeleton[];
    // Backfill geometry for any newly-added arrow that binds by id but supplies no x/y of its own
    // (the same degenerate-arrow bug `spec.ts`/`normalize.ts` fix elsewhere) — `working`'s already-
    // persisted elements supply the bound-node geometry the repair looks up by id.
    return core.convertToExcalidrawElements(repairDegenerateArrowGeometry(combined), { regenerateIds: false });
  }
  return [...working, ...op.elements];
}

interface PersistedArrowLike {
  type: string;
  start?: unknown;
  end?: unknown;
  startBinding?: { elementId?: string } | null;
  endBinding?: { elementId?: string } | null;
}

/**
 * Re-derives `start`/`end` skeleton descriptors from an already-persisted
 * arrow's `startBinding.elementId`/`endBinding.elementId` (see this file's
 * module doc) so a subsequent `convertToExcalidrawElements` call re-affirms
 * the existing binding instead of clearing it. Every other element type is
 * returned unchanged — only arrows go through the bind-by-id step at all.
 */
function withSyntheticEndpoints(elements: readonly unknown[]): unknown[] {
  return elements.map((element) => {
    const arrow = element as PersistedArrowLike;
    if (arrow.type !== "arrow" || arrow.start !== undefined || arrow.end !== undefined) return element;
    const start = arrow.startBinding?.elementId ? { id: arrow.startBinding.elementId } : undefined;
    const end = arrow.endBinding?.elementId ? { id: arrow.endBinding.elementId } : undefined;
    if (!start && !end) return element;
    return { ...(element as object), ...(start ? { start } : {}), ...(end ? { end } : {}) };
  });
}

function applyUpdate(working: unknown[], op: Extract<SceneOp, { action: "update" }>): unknown[] {
  const index = working.findIndex((element) => (element as { id?: string }).id === op.id);
  if (index === -1) {
    throw new OpsError(`update: no element with id '${op.id}' in the current scene.`);
  }
  const sanitizedPatch = Object.fromEntries(
    Object.entries(op.patch).filter(([key]) => !IMMUTABLE_PATCH_FIELDS.has(key)),
  );
  const next = working.slice();
  next[index] = { ...(working[index] as object), ...sanitizedPatch };
  return next;
}

function applyDelete(working: unknown[], op: Extract<SceneOp, { action: "delete" }>): unknown[] {
  if (op.ids.length === 0) {
    throw new OpsError("delete: `ids` must contain at least one id.");
  }

  const workingIds = new Set(working.map((element) => (element as { id: string }).id));
  const missing = op.ids.filter((id) => !workingIds.has(id));
  if (missing.length > 0) {
    throw new OpsError(`delete: no element(s) with id(s) [${missing.join(", ")}] in the current scene.`);
  }

  const toDelete = new Set(op.ids);
  // Cascade one level: deleting a container/arrow should also drop its bound
  // text child, otherwise it's left floating with a `containerId` pointing at
  // nothing — exactly the "orphan label" pitfall research 07 §9 warns about.
  for (const element of working) {
    const el = element as { id: string; boundElements?: Array<{ id: string; type: string }> | null };
    if (!toDelete.has(el.id)) continue;
    for (const bound of el.boundElements ?? []) {
      if (bound.type === "text") toDelete.add(bound.id);
    }
  }

  return working.filter((element) => !toDelete.has((element as { id: string }).id));
}
