/**
 * Region / partial rendering (plan §4-render `crop.ts`, research 07 §7.5): picks
 * which elements a `mode:"region"|"elements"|"frame"` render actually draws, then
 * pulls in **bound partners** so the crop doesn't look broken — plan's exact list:
 * "bound text via `containerId`/`boundElements`, arrows bound to included shapes,
 * `frameId` members, `groupIds` siblings". Note an arrow's *far* endpoint shape is
 * deliberately NOT auto-included (research 07 §7.5: bindings don't affect static
 * drawing, only interactivity — an unbound-looking arrow still renders fine).
 */
import { getExcalidrawCore, type Bounds, type ExcalidrawElement } from "../scene/excalidrawVendor.js";

export type RenderMode = "full" | "region" | "elements" | "frame";

export interface RegionInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropInput {
  elements: readonly ExcalidrawElement[];
  mode: RenderMode;
  region?: RegionInput;
  elementIds?: readonly string[];
  frameId?: string;
}

export interface CropResult {
  elements: ExcalidrawElement[];
  exportingFrame?: ExcalidrawElement;
  warnings: string[];
}

/** Thrown for a request that structurally can't be satisfied (e.g. `mode:"region"` with no `region`). */
export class CropError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CropError";
  }
}

export async function selectElementsForRender(input: CropInput): Promise<CropResult> {
  const live = input.elements.filter((element) => !element.isDeleted);
  const warnings: string[] = [];

  switch (input.mode) {
    case "full":
      return { elements: live, warnings };

    case "frame":
      return selectFrame(live, input.frameId, warnings);

    case "region":
      return selectRegion(live, input.region, warnings);

    case "elements":
      return selectByIds(live, input.elementIds, warnings);

    default: {
      const exhaustive: never = input.mode;
      throw new CropError(`Unknown render mode '${String(exhaustive)}'.`);
    }
  }
}

async function selectFrame(
  live: ExcalidrawElement[],
  frameId: string | undefined,
  warnings: string[],
): Promise<CropResult> {
  if (!frameId) {
    throw new CropError("mode:\"frame\" requires frame_id.");
  }
  const frame = live.find((element) => element.id === frameId);
  if (!frame || (frame.type !== "frame" && frame.type !== "magicframe")) {
    warnings.push(`Frame '${frameId}' not found (or not a frame); rendering the full scene instead.`);
    return { elements: live, warnings };
  }
  // `exportToSvg` clips to `exportingFrame`'s bounds given the full element array —
  // it does its own frame-membership filtering (research 07 §7.5), so we pass
  // every live element through, not just `frameId` members.
  return { elements: live, exportingFrame: frame, warnings };
}

async function selectRegion(
  live: ExcalidrawElement[],
  region: RegionInput | undefined,
  warnings: string[],
): Promise<CropResult> {
  if (!region) {
    throw new CropError("mode:\"region\" requires region:{x,y,width,height}.");
  }
  const core = await getExcalidrawCore();
  const bounds: Bounds = [region.x, region.y, region.x + region.width, region.y + region.height];
  const overlapping = core.elementsOverlappingBBox({ elements: live, bounds, type: "overlap" });
  if (overlapping.length === 0) {
    warnings.push("No elements overlap the requested region; render will be empty.");
  }
  const expanded = pullInBoundPartners(live, overlapping);
  return { elements: expanded, warnings };
}

function selectByIds(
  live: ExcalidrawElement[],
  elementIds: readonly string[] | undefined,
  warnings: string[],
): CropResult {
  if (!elementIds || elementIds.length === 0) {
    throw new CropError("mode:\"elements\" requires a non-empty element_ids list.");
  }
  const byId = new Map(live.map((element) => [element.id, element] as const));
  const found: ExcalidrawElement[] = [];
  for (const id of elementIds) {
    const element = byId.get(id);
    if (element) {
      found.push(element);
    } else {
      warnings.push(`Element '${id}' not found (deleted, or wrong id); skipped.`);
    }
  }
  if (found.length === 0) {
    warnings.push("None of the requested element_ids were found; render will be empty.");
  }
  const expanded = pullInBoundPartners(live, found);
  return { elements: expanded, warnings };
}

/**
 * Fixed-point closure over the plan's four bound-partner categories. A
 * container's own `boundElements` already lists both its bound label text AND
 * any arrow bound to it (research 07 §5), so one rule covers both "bound text"
 * and "arrows bound to included shapes".
 */
function pullInBoundPartners(all: readonly ExcalidrawElement[], seed: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const byId = new Map(all.map((element) => [element.id, element] as const));
  const selected = new Set(seed.map((element) => element.id));

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...selected]) {
      const element = byId.get(id);
      if (!element) continue;

      for (const bound of element.boundElements ?? []) {
        changed = addIfNew(selected, bound.id) || changed;
      }
      if (element.type === "text" && element.containerId) {
        changed = addIfNew(selected, element.containerId) || changed;
      }
      if (element.type === "frame" || element.type === "magicframe") {
        for (const member of all) {
          if (member.frameId === element.id) changed = addIfNew(selected, member.id) || changed;
        }
      }
      if (element.groupIds && element.groupIds.length > 0) {
        const innermost = element.groupIds[element.groupIds.length - 1];
        for (const sibling of all) {
          if (sibling.groupIds?.includes(innermost)) changed = addIfNew(selected, sibling.id) || changed;
        }
      }
    }
  }

  return all.filter((element) => selected.has(element.id));
}

function addIfNew(set: Set<string>, id: string): boolean {
  if (set.has(id)) return false;
  set.add(id);
  return true;
}
