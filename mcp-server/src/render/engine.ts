/**
 * `RenderBackend` contract (plan §4-render) + selection by
 * `EXCALIDASH_RENDER_ENGINE` (default `resvg`, opt-in `browser`). Both
 * `render/resvg.ts` and `render/browser.ts` implement this same interface so the
 * `excalidash_render`/create/edit tools (T7) never branch on engine — they just
 * call `selectRenderBackend().render(input)`.
 *
 * `elements`/`files`/`appState` here are the ALREADY-CROPPED, already-SSRF-resolved
 * inputs (see `crop.ts`, `images.ts`); this module is deliberately dumb about scene
 * selection and only knows how to turn a fixed element set into pixels.
 */
import { getConfig, type RenderEngine } from "../config.js";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "../scene/excalidrawVendor.js";
import { createBrowserBackend } from "./browser.js";
import { createResvgBackend } from "./resvg.js";

/** `background` selects how the resvg/browser rasterizer composites behind the scene's own painted rect. */
export type RenderBackgroundMode = "white" | "transparent" | "theme";

export interface RenderInput {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  appState: Pick<AppState, "viewBackgroundColor" | "exportBackground"> & { exportPadding?: number };
  /** Pixel clamp for the longest output side (plan §2.3 `max_width`, §4-render `clamp.ts`). */
  maxLongSide: number;
  scale?: number;
  background: RenderBackgroundMode;
  /** Set for `mode:"frame"` renders; `exportToSvg` clips to this frame's bounds. */
  exportingFrame?: ExcalidrawFrameLikeElement;
}

export interface RenderResult {
  png: Buffer;
  width: number;
  height: number;
  svg?: string;
}

export interface RenderBackend {
  render(input: RenderInput): Promise<RenderResult>;
}

/** Thrown for engine-level failures that need an actionable message, not a stack trace. */
export class RenderEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderEngineError";
  }
}

let resvgBackend: RenderBackend | undefined;
let browserBackend: RenderBackend | undefined;

/**
 * Returns the singleton `RenderBackend` for the given engine (default: the
 * process config's `EXCALIDASH_RENDER_ENGINE`, itself default `resvg`). Both
 * backends are cheap to construct — the resvg backend does no work until
 * `.render()` is called, and the browser backend only touches `playwright` (an
 * optional dependency that may not be installed) inside its own `.render()`.
 */
export function selectRenderBackend(engine: RenderEngine = getConfig().renderEngine): RenderBackend {
  if (engine === "browser") {
    if (!browserBackend) browserBackend = createBrowserBackend();
    return browserBackend;
  }
  if (!resvgBackend) resvgBackend = createResvgBackend();
  return resvgBackend;
}

/** Test-only escape hatch: forces fresh backend instances on the next `selectRenderBackend()` call. */
export function resetRenderBackendsForTests(): void {
  resvgBackend = undefined;
  browserBackend = undefined;
}
