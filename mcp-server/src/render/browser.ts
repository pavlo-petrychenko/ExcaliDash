/**
 * OPT-IN render backend (plan §4-render): a singleton headless Chromium loads
 * `render/page/index.html` and the browser-targeted vendor bundle
 * (`dist/vendor/excalidraw-core.browser.js`, built by `scripts/build-vendor.mjs`),
 * then calls `exportToSvg`/`exportToCanvas` **in-page** — a real browser gives
 * native canvas `measureText` and real font rasterization (best hand-drawn
 * fidelity, research 07 §7.3), so none of `scene/browserEnv.ts`'s jsdom shims
 * apply here.
 *
 * `playwright` is an `optionalDependency` (plan §1) that may not be installed —
 * this module never statically imports it (neither as a value nor as a type;
 * see `loadPlaywright`'s comment) so `tsc`/`resvg` users are unaffected when it's
 * absent. Selecting `EXCALIDASH_RENDER_ENGINE=browser` without it installed
 * produces one actionable error instead of a module-resolution crash.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RenderEngineError, type RenderBackend, type RenderInput, type RenderResult } from "./engine.js";

/** Structural typing for the slice of Playwright's API this module touches — see header comment. */
interface PwPage {
  goto(url: string): Promise<unknown>;
  addScriptTag(options: { path: string }): Promise<unknown>;
  evaluate<T, A>(pageFunction: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
  close(): Promise<void>;
}
interface PwBrowser {
  newPage(): Promise<PwPage>;
}
interface PwModule {
  chromium: { launch(options?: { headless?: boolean }): Promise<PwBrowser> };
}

interface PageEvalInput {
  elements: unknown[];
  files: Record<string, unknown>;
  appState: { viewBackgroundColor: string; exportBackground: boolean; exportPadding: number };
  exportingFrame: unknown;
  background?: string;
  scale: number;
  maxLongSide: number;
}
interface PageEvalResult {
  pngBase64: string;
  width: number;
  height: number;
  svg: string;
}

/**
 * `import("playwright")` with a variable specifier: TypeScript only attempts to
 * statically resolve *literal* dynamic-import specifiers, so this stays
 * `Promise<any>` and compiles whether or not the package is on disk.
 */
async function loadPlaywright(): Promise<PwModule> {
  const specifier = "playwright";
  try {
    return (await import(specifier)) as PwModule;
  } catch (error) {
    throw new RenderEngineError(
      "EXCALIDASH_RENDER_ENGINE=browser needs the optional `playwright` package, which is " +
        "not installed. Run `npm install playwright && npx playwright install chromium` in " +
        `mcp-server/, or unset EXCALIDASH_RENDER_ENGINE (default "resvg" needs no browser). ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
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

let browserPromise: Promise<PwBrowser> | undefined;

/** Launches Chromium once (singleton, ~3s cold / reused warm — research 07 §7.3) and caches the handle. */
function getBrowser(): Promise<PwBrowser> {
  if (!browserPromise) {
    browserPromise = loadPlaywright()
      .then((playwright) => playwright.chromium.launch({ headless: true }))
      .catch((error: unknown) => {
        browserPromise = undefined; // don't cache a failed launch forever
        throw error;
      });
  }
  return browserPromise;
}

export function createBrowserBackend(): RenderBackend {
  return {
    async render(input: RenderInput): Promise<RenderResult> {
      const browser = await getBrowser();
      const here = path.dirname(fileURLToPath(import.meta.url));
      const packageRoot = findPackageRoot(here);
      const pageUrl = pathToFileURL(path.join(packageRoot, "dist", "render", "page", "index.html")).href;
      const bundlePath = path.join(packageRoot, "dist", "vendor", "excalidraw-core.browser.js");

      const page = await browser.newPage();
      try {
        await page.goto(pageUrl);
        await page.addScriptTag({ path: bundlePath });

        const evalInput: PageEvalInput = {
          elements: input.elements as unknown[],
          files: (input.files ?? {}) as Record<string, unknown>,
          appState: {
            viewBackgroundColor: input.appState.viewBackgroundColor,
            exportBackground: input.appState.exportBackground,
            exportPadding: input.appState.exportPadding ?? 16,
          },
          exportingFrame: input.exportingFrame ?? null,
          background: input.background === "white" ? "#ffffff" : undefined,
          scale: input.scale ?? 1,
          maxLongSide: input.maxLongSide,
        };

        const result = await page.evaluate(evaluateInPage, evalInput);
        return {
          png: Buffer.from(result.pngBase64, "base64"),
          width: result.width,
          height: result.height,
          svg: result.svg,
        };
      } finally {
        await page.close();
      }
    },
  };
}

/**
 * Runs INSIDE the Playwright page (native browser globals; Playwright serializes
 * this function to a string and evaluates it in-page, so it cannot close over
 * anything from the surrounding module — every input comes through `arg`).
 */
async function evaluateInPage(input: PageEvalInput): Promise<PageEvalResult> {
  const core = (window as unknown as { __excalidashCore: Record<string, (...args: never[]) => unknown> })
    .__excalidashCore;
  const exportToSvg = core.exportToSvg as (opts: unknown) => Promise<SVGSVGElement>;
  const exportToCanvas = core.exportToCanvas as (opts: unknown) => Promise<HTMLCanvasElement>;

  const svgElement = await exportToSvg({
    elements: input.elements,
    files: input.files,
    appState: { viewBackgroundColor: input.appState.viewBackgroundColor, exportBackground: input.appState.exportBackground },
    exportPadding: input.appState.exportPadding,
    exportingFrame: input.exportingFrame,
  });
  const svg = new XMLSerializer().serializeToString(svgElement);
  const naturalWidth = Number(svgElement.getAttribute("width"));
  const naturalHeight = Number(svgElement.getAttribute("height"));
  const naturalLongSide = Math.max(naturalWidth, naturalHeight);
  const requestedLongSide = naturalLongSide * input.scale;
  const finalScale = requestedLongSide > input.maxLongSide ? input.maxLongSide / naturalLongSide : input.scale;

  const canvas = await exportToCanvas({
    elements: input.elements,
    files: input.files,
    appState: { viewBackgroundColor: input.appState.viewBackgroundColor, exportBackground: input.appState.exportBackground },
    exportPadding: input.appState.exportPadding,
    exportingFrame: input.exportingFrame,
    getDimensions: (w: number, h: number) => ({
      width: Math.round(w * finalScale),
      height: Math.round(h * finalScale),
      scale: finalScale,
    }),
  });

  if (input.background) {
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = input.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    ),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { pngBase64: btoa(binary), width: canvas.width, height: canvas.height, svg };
}
