/**
 * Runtime loader for the pre-bundled `@excalidraw/excalidraw` core (see
 * `scripts/build-vendor.mjs` for WHY this indirection exists instead of importing
 * `@excalidraw/excalidraw` directly). Every module that needs
 * `convertToExcalidrawElements`/`restoreElements` — today `scene/normalize.ts`,
 * later the render engines — goes through `getExcalidrawCore()` instead of
 * importing the package itself.
 *
 * Resolution: walks up from this file's own location to find the package root
 * (the nearest ancestor directory containing `package.json`), then loads
 * `dist/vendor/excalidraw-core.mjs` from there. This is deliberately independent
 * of whether the *caller* is running compiled (`dist/scene/...`) or as TS source
 * under vitest (`src/scene/...`) — both live at the same depth under the package
 * root, and both need the one bundle produced by `npm run build` /
 * `node scripts/build-vendor.mjs` (wired as `pretest`, so `npm test` always has a
 * fresh copy).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureBrowserEnvironment } from "./browserEnv.js";
import { heuristicTextMetricsProvider } from "./textMetrics.js";

// Type-only: erased at compile time, so it never triggers the runtime import
// problems `build-vendor.mjs` documents. Resolved via the package's per-subpath
// `types` export condition (works even though the *runtime* subpath is blocked).
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { Bounds } from "@excalidraw/excalidraw/element/bounds";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export type {
  ExcalidrawElementSkeleton,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  OrderedExcalidrawElement,
  Bounds,
  AppState,
  BinaryFiles,
};

/** The subset of `exportToSvg`'s `appState` option the render engines (T6) set. */
export type ExportAppState = Partial<Omit<AppState, "offsetTop" | "offsetLeft">>;

export interface ExcalidrawCore {
  convertToExcalidrawElements: (
    skeleton: ExcalidrawElementSkeleton[] | null,
    opts?: { regenerateIds?: boolean },
  ) => OrderedExcalidrawElement[];
  restoreElements: (
    elements: ImportedDataState["elements"],
    localElements: readonly ExcalidrawElement[] | null | undefined,
    opts?: { refreshDimensions?: boolean; repairBindings?: boolean },
  ) => OrderedExcalidrawElement[];
  /**
   * Renders a scene to an in-memory `SVGSVGElement` (jsdom node) — the input to
   * the resvg engine. Note `exportPadding` is a TOP-LEVEL option, sibling to
   * `appState` (`utils/export.d.ts`), not nested inside it.
   */
  exportToSvg: (opts: {
    elements: readonly ExcalidrawElement[];
    appState?: ExportAppState;
    files: BinaryFiles | null;
    exportPadding?: number;
    exportingFrame?: ExcalidrawFrameLikeElement | null;
    skipInliningFonts?: true;
    renderEmbeddables?: boolean;
  }) => Promise<SVGSVGElement>;
  /** `[minX, minY, maxX, maxY]` over an element array — used by `render/crop.ts` for region math. */
  getCommonBounds: (elements: readonly ExcalidrawElement[]) => Bounds;
  elementsOverlappingBBox: (args: {
    elements: readonly ExcalidrawElement[];
    bounds: Bounds;
    type: "overlap" | "contain" | "inside";
  }) => ExcalidrawElement[];
  isElementInsideBBox: (element: ExcalidrawElement, bbox: Bounds, eitherDirection?: boolean) => boolean;
  elementPartiallyOverlapsWithOrContainsBBox: (element: ExcalidrawElement, bbox: Bounds) => boolean;
}

/** Thrown when `dist/vendor/excalidraw-core.mjs` hasn't been built yet. */
export class VendorBundleMissingError extends Error {
  constructor(expectedPath: string) {
    super(
      `excalidash-mcp: ${expectedPath} not found. Run "npm run build" (or ` +
        '"node scripts/build-vendor.mjs") in mcp-server/ first — it bundles ' +
        "@excalidraw/excalidraw into a form plain Node can import (see that script's " +
        "header comment for why the raw package can't be imported directly).",
    );
    this.name = "VendorBundleMissingError";
  }
}

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`excalidash-mcp: could not locate package.json above ${startDir}`);
    }
    dir = parent;
  }
}

let corePromise: Promise<ExcalidrawCore> | undefined;

/**
 * Returns the singleton bundled excalidraw core, loading it (and installing the
 * browser-global shims + text metrics provider) on first call. Safe to call
 * repeatedly and concurrently.
 */
export function getExcalidrawCore(): Promise<ExcalidrawCore> {
  if (!corePromise) {
    corePromise = loadCore().catch((error: unknown) => {
      // Don't cache a rejected load forever — a subsequent call (e.g. after the
      // caller runs the build) should retry instead of replaying the same error.
      corePromise = undefined;
      throw error;
    });
  }
  return corePromise;
}

async function loadCore(): Promise<ExcalidrawCore> {
  ensureBrowserEnvironment();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = findPackageRoot(here);
  const bundlePath = path.join(packageRoot, "dist", "vendor", "excalidraw-core.mjs");
  if (!existsSync(bundlePath)) {
    throw new VendorBundleMissingError(bundlePath);
  }

  const core = (await import(pathToFileURL(bundlePath).href)) as ExcalidrawCore & {
    setCustomTextMetricsProvider: (provider: typeof heuristicTextMetricsProvider) => void;
  };
  core.setCustomTextMetricsProvider(heuristicTextMetricsProvider);
  return core;
}

/** Test-only escape hatch to force a fresh load on the next `getExcalidrawCore()` call. */
export function resetExcalidrawCoreForTests(): void {
  corePromise = undefined;
}
