/**
 * Text-width estimator fed to `setCustomTextMetricsProvider` (excalidraw's escape
 * hatch for "canvas 2D `measureText` isn't available", plan §4-render bullet 2 /
 * research 07 §3.4 & §7.2). Without this, `convertToExcalidrawElements` and
 * `restoreElements` fall back to the browser's canvas `measureText`, which does
 * not exist under Node (we deliberately don't install `canvas`/cairo — see
 * `browserEnv.ts`).
 *
 * This is an approximation, not a pixel-accurate glyph-advance measurement: it
 * multiplies character count by font size and a fixed average-character-width
 * ratio. That's enough to size bound-text containers sensibly and to drive the
 * "label may overflow its box" heuristic (plan §4.3) — it is explicitly a
 * heuristic there too. Pixel-accurate rendering (for the PNG a human actually
 * looks at) is the render engine's job (T6, `render/resvg.ts`), which rasterizes
 * through resvg with the real Excalidraw font files.
 */

/** Average glyph width as a fraction of font size, for proportional (non-monospace) fonts. */
const AVERAGE_CHAR_WIDTH_RATIO = 0.55;

/** Matches the leading `<number>px` of a CSS-shorthand font string, e.g. `"20px Excalifont"`. */
const FONT_SIZE_PATTERN = /^(\d+(?:\.\d+)?)px/;

/**
 * Shape expected by `setCustomTextMetricsProvider` (`TextMetricsProvider` in
 * `@excalidraw/excalidraw`'s `element/textMeasurements`).
 */
export interface TextMetricsProvider {
  getLineWidth(text: string, fontString: string): number;
}

function parseFontSize(fontString: string): number {
  const match = FONT_SIZE_PATTERN.exec(fontString.trim());
  if (!match) return 20; // DEFAULT_FONT_SIZE, matches excalidraw's own default.
  const size = Number(match[1]);
  return Number.isFinite(size) && size > 0 ? size : 20;
}

/** The provider installed into excalidraw by `excalidrawVendor.ts`. */
export const heuristicTextMetricsProvider: TextMetricsProvider = {
  getLineWidth(text: string, fontString: string): number {
    return estimateTextWidth(text, parseFontSize(fontString));
  },
};

/**
 * Same estimate as `heuristicTextMetricsProvider`, exposed directly for
 * `normalize.ts`'s text-overflow warning (plan §4.3) so both use one consistent
 * heuristic instead of round-tripping through a synthetic font string.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * AVERAGE_CHAR_WIDTH_RATIO;
}
