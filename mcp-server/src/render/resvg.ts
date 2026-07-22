/**
 * DEFAULT render backend (plan §4-render): jsdom + `exportToSvg` + `@resvg/resvg-js`,
 * pure Node, no Chromium download. `getExcalidrawCore()` (via `excalidrawVendor.ts`)
 * already installs the jsdom globals `exportToSvg` needs (`document.createElementNS`
 * for the `<svg>`, `XMLSerializer`, etc. — research 07 §7.2) before this module ever
 * touches it, and feeds text measurement through `setCustomTextMetricsProvider`
 * instead of a native canvas.
 *
 * resvg cannot parse Excalidraw's woff2 font files directly (see `fonts.ts`'s
 * header comment), so fonts are fed as pre-converted TTF `fontFiles` — resvg
 * matches them to the SVG's `font-family` text by the font's own internal name.
 */
import { Resvg } from "@resvg/resvg-js";
import { getExcalidrawCore } from "../scene/excalidrawVendor.js";
import { clampDimensions } from "./clamp.js";
import type { RenderBackend, RenderBackgroundMode, RenderInput, RenderResult } from "./engine.js";
import { RenderEngineError } from "./engine.js";
import { getFontFilePaths } from "./fonts.js";

/** Padding (px, unscaled) around the scene bounds in the exported SVG — matches research 07 §9's worked example. */
const DEFAULT_EXPORT_PADDING = 16;

export function createResvgBackend(): RenderBackend {
  return {
    async render(input: RenderInput): Promise<RenderResult> {
      const core = await getExcalidrawCore();

      const svgElement = await core.exportToSvg({
        elements: input.elements,
        files: input.files ?? null,
        appState: {
          viewBackgroundColor: input.appState.viewBackgroundColor,
          exportBackground: input.appState.exportBackground,
        },
        exportPadding: input.appState.exportPadding ?? DEFAULT_EXPORT_PADDING,
        exportingFrame: input.exportingFrame ?? null,
      });

      const svg = serializeSvg(svgElement);
      const { naturalWidth, naturalHeight } = readNaturalSize(svgElement);
      const clamp = clampDimensions({
        naturalWidth,
        naturalHeight,
        scale: input.scale,
        maxLongSide: input.maxLongSide,
      });

      const resvg = new Resvg(svg, {
        fitTo: { mode: "zoom", value: clamp.scale },
        background: resolveBackgroundOption(input.background),
        font: {
          loadSystemFonts: true, // fallback for families with no bundled TTF (e.g. Helvetica) — never a network fetch
          fontFiles: getFontFilePaths(),
          defaultFontFamily: "Excalifont",
        },
      });

      let rendered: ReturnType<Resvg["render"]>;
      try {
        rendered = resvg.render();
      } catch (error) {
        throw new RenderEngineError(
          `resvg failed to rasterize the exported SVG: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const png = rendered.asPng();

      return { png, width: rendered.width, height: rendered.height, svg };
    },
  };
}

function serializeSvg(svgElement: SVGSVGElement): string {
  const serializer = new (globalThis as typeof globalThis & { XMLSerializer: typeof XMLSerializer }).XMLSerializer();
  return serializer.serializeToString(svgElement);
}

/** `exportToSvg` sets plain numeric-px `width`/`height` attributes on the root `<svg>` (research 07 §7.1). */
function readNaturalSize(svgElement: SVGSVGElement): { naturalWidth: number; naturalHeight: number } {
  const width = Number(svgElement.getAttribute("width"));
  const height = Number(svgElement.getAttribute("height"));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RenderEngineError(
      `exportToSvg produced an SVG without usable width/height attributes ("${svgElement.getAttribute("width")}" x "${svgElement.getAttribute("height")}").`,
    );
  }
  return { naturalWidth: width, naturalHeight: height };
}

/**
 * "white"/"transparent" force resvg's own compositing background; "theme" leaves
 * it unset and trusts the scene's own `appState.viewBackgroundColor` rect
 * (already baked into the SVG via `exportBackground`) — see `engine.ts`'s
 * `RenderBackgroundMode` doc.
 */
function resolveBackgroundOption(mode: RenderBackgroundMode): string | undefined {
  if (mode === "white") return "#ffffff";
  return undefined;
}
