#!/usr/bin/env node
/**
 * Bundles the subset of @excalidraw/excalidraw's browser-oriented ESM build that
 * `src/scene/*` (and later the render engines) need into a single self-contained
 * ES module at `dist/vendor/excalidraw-core.mjs`.
 *
 * WHY THIS EXISTS: @excalidraw/excalidraw@0.18.1 ships only a browser-targeted ESM
 * bundle (no CJS build) that assumes a bundler resolves its internals. Importing it
 * directly under plain Node's ESM loader breaks in several ways a real bundler
 * papers over:
 *   - `roughjs/bin/rough` (and sibling roughjs subpaths) are imported without a
 *     file extension — Node's ESM resolver requires one.
 *   - `open-color`'s package.json "main" points straight at a `.json` file; Node's
 *     ESM loader (unlike CJS `require`) refuses to load JSON without an import
 *     attribute, which the excalidraw bundle's `import` statement doesn't set.
 *   - `@excalidraw/laser-pointer` is CJS; Node's static named-export detection for
 *     "import { X } from cjsPkg" can't always see its exports.
 * esbuild's bundler resolves/rewrites all of the above the same way the frontend's
 * own Vite build already does for the browser. We bundle once here, at build time,
 * and the runtime loader (`src/scene/excalidrawVendor.ts`) imports the flat output
 * instead of reaching into node_modules/@excalidraw/excalidraw directly.
 *
 * Run via `npm run build` (wired as a prebuild step) or directly:
 *   node scripts/build-vendor.mjs
 */
import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const outfile = path.join(packageRoot, "dist", "vendor", "excalidraw-core.mjs");
const browserOutfile = path.join(packageRoot, "dist", "vendor", "excalidraw-core.browser.js");

// scene/normalize.ts (T4) needs convertToExcalidrawElements/restoreElements/
// setCustomTextMetricsProvider. The render engines (T6, render/resvg.ts +
// render/crop.ts) additionally need exportToSvg (SVG generation) and the bounds/
// bbox-overlap helpers used to compute region/element-subset crops.
const ENTRY_SOURCE = `
export {
  convertToExcalidrawElements,
  restoreElements,
  setCustomTextMetricsProvider,
  exportToSvg,
  getCommonBounds,
  elementsOverlappingBBox,
  isElementInsideBBox,
  elementPartiallyOverlapsWithOrContainsBBox,
} from "@excalidraw/excalidraw";
`;

async function buildNodeBundle() {
  const result = await build({
    stdin: {
      contents: ENTRY_SOURCE,
      resolveDir: packageRoot,
      loader: "ts",
      sourcefile: "excalidraw-core-entry.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: true,
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });

  const [file] = result.outputFiles;
  await writeFile(outfile, file.contents);
  const sizeMb = (file.contents.byteLength / (1024 * 1024)).toFixed(1);
  console.error(
    `excalidash-mcp: bundled @excalidraw/excalidraw core -> ${path.relative(packageRoot, outfile)} (${sizeMb} MB)`,
  );
}

/**
 * Second bundle, browser-targeted (IIFE, global `__excalidashCore`), for
 * `render/browser.ts` (T6, opt-in Playwright render engine). Unlike the Node
 * bundle above, this one runs inside a REAL browser page (Playwright/Chromium),
 * so it needs none of `scene/browserEnv.ts`'s jsdom shims — real `window`,
 * `document`, canvas `measureText`, and Font Loading API are all native there,
 * which is the whole point of the browser engine (best hand-drawn fidelity,
 * research 07 §7.3). `render/browser.ts` loads this file into the page via
 * Playwright's `addScriptTag` (a classic, non-module script, so the IIFE's
 * `globalName` actually lands on `window`).
 */
async function buildBrowserBundle() {
  const result = await build({
    stdin: {
      contents: ENTRY_SOURCE,
      resolveDir: packageRoot,
      loader: "ts",
      sourcefile: "excalidraw-core-entry.ts",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "__excalidashCore",
    target: "es2022",
    minify: true,
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });

  const [file] = result.outputFiles;
  await writeFile(browserOutfile, file.contents);
  const sizeMb = (file.contents.byteLength / (1024 * 1024)).toFixed(1);
  console.error(
    `excalidash-mcp: bundled @excalidraw/excalidraw core (browser) -> ${path.relative(packageRoot, browserOutfile)} (${sizeMb} MB)`,
  );
}

/**
 * `tsc` only compiles `.ts` -> `dist/`; the static browser-engine page (no
 * TypeScript in it) needs a plain copy so `render/browser.ts`'s hardcoded
 * `dist/render/page/index.html` path resolves the same in dev (vitest, against
 * `src/`) and after `npm run build` (against `dist/`).
 */
async function copyRenderPage() {
  const src = path.join(packageRoot, "src", "render", "page", "index.html");
  const dest = path.join(packageRoot, "dist", "render", "page", "index.html");
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

async function main() {
  await mkdir(path.dirname(outfile), { recursive: true });
  await buildNodeBundle();
  await buildBrowserBundle();
  await copyRenderPage();
}

main().catch((error) => {
  console.error("excalidash-mcp: failed to bundle @excalidraw/excalidraw for runtime use.", error);
  process.exit(1);
});
