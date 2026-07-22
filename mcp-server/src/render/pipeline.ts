/**
 * Render composition (plan §2.3's "Behavior: fetch → normalize (§4) → crop.ts
 * selection → engine render (§4-render) → clamp.ts"): the one place that wires
 * `scene/normalize.ts` + `crop.ts` + `images.ts` + `engine.ts` together into "a
 * drawing record in, pixels out". `excalidash_render` calls this directly;
 * `create_diagram`/`edit_diagram` call it for their `render:true` default so
 * every mutating tool sees the *exact* same rendering behavior (T7 owns this
 * file — it is tool-orchestration glue, not render-engine internals, which is
 * why it lives alongside `engine.ts` rather than duplicated into `tools/*`).
 */
import type { RenderEngine } from "../config.js";
import { normalizeElements } from "../scene/normalize.js";
import type { BinaryFiles, ExcalidrawFrameLikeElement } from "../scene/excalidrawVendor.js";
import { selectElementsForRender, type CropInput } from "./crop.js";
import { selectRenderBackend } from "./engine.js";
import type { RenderBackgroundMode, RenderResult } from "./engine.js";
import { resolveImages } from "./images.js";

export interface RenderDrawingInput {
  /** Raw (`unknown[]`) elements as returned by the ExcaliDash API — re-normalized defensively before rendering. */
  elements: unknown[];
  /** Raw files map as returned by the API, or null/undefined. */
  files: unknown;
  appState: Record<string, unknown> | null | undefined;
  mode: CropInput["mode"];
  region?: CropInput["region"];
  elementIds?: CropInput["elementIds"];
  frameId?: CropInput["frameId"];
  scale?: number;
  maxLongSide: number;
  background: RenderBackgroundMode;
  engine?: RenderEngine;
}

export interface RenderDrawingResult extends RenderResult {
  elementCount: number;
  warnings: string[];
}

const DEFAULT_BACKGROUND_COLOR = "#ffffff";

export async function renderDrawing(input: RenderDrawingInput): Promise<RenderDrawingResult> {
  const warnings: string[] = [];

  const normalized = await normalizeElements(input.elements);
  warnings.push(...normalized.warnings);

  const cropped = await selectElementsForRender({
    elements: normalized.elements,
    mode: input.mode,
    region: input.region,
    elementIds: input.elementIds,
    frameId: input.frameId,
  });
  warnings.push(...cropped.warnings);

  const resolvedImages = await resolveImages(input.files as BinaryFiles | null | undefined);
  warnings.push(...resolvedImages.warnings);

  const viewBackgroundColor = readViewBackgroundColor(input.appState);
  const backend = selectRenderBackend(input.engine);
  const result = await backend.render({
    elements: cropped.elements,
    files: resolvedImages.files,
    appState: { viewBackgroundColor, exportBackground: true },
    maxLongSide: input.maxLongSide,
    scale: input.scale,
    background: input.background,
    // `selectFrame` (crop.ts) only ever sets this when it has already checked
    // `type === "frame" | "magicframe"`; `CropResult`'s field is typed as the
    // wider `ExcalidrawElement` only because that guard lives in a different
    // function than the return statement, so TS can't see the narrowing here.
    exportingFrame: cropped.exportingFrame as ExcalidrawFrameLikeElement | undefined,
  });

  return { ...result, elementCount: cropped.elements.length, warnings };
}

function readViewBackgroundColor(appState: Record<string, unknown> | null | undefined): string {
  const value = appState?.viewBackgroundColor;
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_BACKGROUND_COLOR;
}
