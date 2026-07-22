/**
 * Installs the minimal browser globals `@excalidraw/excalidraw` touches at module
 * load and during `convertToExcalidrawElements`/`restoreElements` — even when we
 * never render anything. Must run before the bundled excalidraw core is imported
 * (see `excalidrawVendor.ts`, which calls this first).
 *
 * Excalidraw is a browser-only package: importing it evaluates code that expects
 * `window`/`document`/`navigator` (jsdom), a `HTMLCanvasElement.getContext("2d")`
 * that doesn't throw (module-scope feature detection), the Font Loading API
 * (`FontFace`, `document.fonts`) to register its bundled fonts, `devicePixelRatio`,
 * `matchMedia`, and `ResizeObserver`. We deliberately do NOT pull in a native
 * `canvas` package for 2D context support (that's the whole point of the resvg
 * render engine avoiding node-canvas/cairo, plan §4-render) — text measurement is
 * instead redirected through `setCustomTextMetricsProvider` (see
 * `textMetrics.ts`), so the canvas stub only needs to be "not null", never
 * "correct".
 *
 * Idempotent: safe to call from every entry point (tools, tests, the render
 * engine) without double-installing. Also safe when a test runner's own `jsdom`
 * environment already provided `window`/`document` — in that case we reuse them
 * and only patch the pieces excalidraw additionally needs.
 */
import { JSDOM } from "jsdom";

let installed = false;

/** Global keys we never copy from a fresh JSDOM window onto globalThis. */
const SKIP_GLOBALS = new Set(["window", "self", "top", "parent", "frames", "globalThis", "location"]);

/**
 * Timer/task-scheduling globals jsdom's `window` implements by (indirectly)
 * calling back into `globalThis`'s own version of themselves — swapping them
 * for jsdom's copy therefore recurses infinitely the moment anything actually
 * schedules a timer (surfaced by `exportToSvg`'s async font-face pipeline, T6:
 * `render/resvg.ts`). Node's own implementations are already spec-correct, so
 * these are never copied regardless of `installJsdomGlobals`'s general
 * already-defined check below (defense in depth, since the reason is subtler
 * than "already defined").
 *
 * `atob`/`btoa` are for the same reason: jsdom's own implementation is NOT a
 * drop-in replacement for Node's native one — it throws "invalid characters"
 * on some perfectly valid base64 strings that Node's `atob` (and
 * `Buffer.toString("base64")`'s own output) accept fine. Once this module
 * installs jsdom's globals (i.e. the first time anything renders), that
 * broken `atob` becomes `globalThis.atob` for the rest of the process — and
 * the MCP SDK validates every OUTGOING `{type:"image"}` content block's
 * base64 `data` field with exactly `globalThis.atob` (see
 * `@modelcontextprotocol/sdk`'s `Base64Schema`), so every image render after
 * the first one would fail that validation with a false "Invalid Base64
 * string" (T7 caught this via `tools/createDiagram.test.ts`'s end-to-end
 * assertion — a plain unit test on this module wouldn't have surfaced it).
 * Node has had spec-correct `atob`/`btoa` since v16; excalidraw's own
 * export/convert path never needs jsdom's browser copy specifically.
 *
 * `performance` is excluded for the same class of reason, found by T9's real
 * (not faked-`fetch`) e2e harness: jsdom's `Performance` object lacks
 * `markResourceTiming`, which Node's own native `fetch` (undici) calls on
 * `globalThis.performance` at the end of every request to record timing —
 * once jsdom's copy has clobbered it, the very next real `fetch()` call
 * anywhere in the process (e.g. `api/client.ts`'s call to the ExcaliDash
 * backend, made from a tool handler run after any render) throws
 * "markResourceTiming is not a function" and crashes the whole MCP server
 * process. jsdom's `performance.now()` isn't meaningfully different from
 * Node's for excalidraw's purposes, so keeping Node's native object is safe.
 */
const NEVER_OVERRIDE_GLOBALS = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "atob",
  "btoa",
  "performance",
]);

export function ensureBrowserEnvironment(): void {
  if (installed) return;
  installed = true;

  if (typeof (globalThis as { window?: unknown }).window === "undefined") {
    installJsdomGlobals();
  }
  patchCanvasGetContext();
  patchFontLoadingApi();
  patchMiscGlobals();
}

function installJsdomGlobals(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const { window } = dom;
  const target = globalThis as Record<string, unknown>;

  for (const key of Object.getOwnPropertyNames(window)) {
    if (SKIP_GLOBALS.has(key) || NEVER_OVERRIDE_GLOBALS.has(key)) continue;
    try {
      target[key] = (window as unknown as Record<string, unknown>)[key];
    } catch {
      // Some window properties are non-configurable getters; skip those, they're
      // never the ones excalidraw's module-load code touches.
    }
  }
  target.window = window;
  target.document = window.document;
  target.navigator = window.navigator;
}

function patchCanvasGetContext(): void {
  const canvasCtor = (globalThis as unknown as { HTMLCanvasElement?: { prototype: Record<string, unknown> } })
    .HTMLCanvasElement;
  if (!canvasCtor) return;
  // A real 2D context is never provided (no node-canvas). Only guarantee the
  // module-scope `"filter" in ctx` style feature checks see a non-null object;
  // real text sizing goes through `setCustomTextMetricsProvider` instead.
  canvasCtor.prototype.getContext = () => ({});
}

function patchFontLoadingApi(): void {
  const target = globalThis as Record<string, unknown>;
  if (typeof target.FontFace === "undefined") {
    target.FontFace = class FontFaceStub {
      family: string;
      constructor(family: string, _source?: unknown, _descriptors?: unknown) {
        this.family = family;
      }
      load(): Promise<this> {
        return Promise.resolve(this);
      }
    };
  }

  const doc = target.document as { fonts?: unknown } | undefined;
  if (doc && typeof doc.fonts === "undefined") {
    const registered = new Set<unknown>();
    doc.fonts = {
      add: (face: unknown) => registered.add(face),
      delete: (face: unknown) => registered.delete(face),
      forEach: (callback: (face: unknown) => void) => registered.forEach(callback),
      ready: Promise.resolve(),
      check: () => true,
    };
  }
}

function patchMiscGlobals(): void {
  const target = globalThis as Record<string, unknown>;
  if (typeof target.devicePixelRatio === "undefined") {
    target.devicePixelRatio = 1;
  }
  if (typeof target.matchMedia === "undefined") {
    target.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (typeof target.ResizeObserver === "undefined") {
    target.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

/** Test-only escape hatch: forces the next `ensureBrowserEnvironment()` call to reinstall. */
export function resetBrowserEnvironmentForTests(): void {
  installed = false;
}
