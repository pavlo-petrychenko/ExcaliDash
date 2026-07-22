/**
 * Locates the Excalidraw TTF font files the resvg engine feeds to
 * `@resvg/resvg-js` as `font.fontFiles` (plan §4-render bullet 4). `@resvg/resvg-js`
 * does not reliably parse the woff2 files `@excalidraw/excalidraw` ships in
 * `dist/prod/fonts/**` (verified: its bundled `fontdb` reports "malformed font"
 * for every one of them), so these TTFs are pre-converted once (see the header
 * comment in `mcp-server/fonts/README.md` for exactly how and with what tool) and
 * committed as binary assets at the package root, analogous to the `dist/vendor`
 * bundle — a build-time asset, not a runtime dependency.
 *
 * Resolution walks up from this file's own location to the package root (same
 * technique as `scene/excalidrawVendor.ts`), so it works identically whether the
 * caller is running compiled (`dist/render/...`) or as TS source under vitest
 * (`src/render/...`).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Numeric `fontFamily` id -> CSS `font-family` name Excalidraw writes into
 * `exportToSvg`'s output (research 07 §6/§6.1; matches `normalize.ts`'s
 * `EXPECTED_LINE_HEIGHT_BY_FONT_FAMILY` keys). `Excalifont` (5) is
 * `DEFAULT_FONT_FAMILY` and the only family a `DiagramSpec`-authored scene ever
 * uses; the rest matter only for the raw-`elements` escape hatch.
 */
export const FONT_FAMILY_NAMES: Record<number, string> = {
  1: "Virgil",
  3: "Cascadia",
  5: "Excalifont",
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans",
  // 2 (Helvetica) intentionally has no bundled asset — Excalidraw's own
  // `@font-face` for it points at the system font stack, and so does resvg's
  // system-font fallback (`loadSystemFonts:true` alongside these `fontFiles`).
};

const FONT_FILES_BY_FAMILY_NAME: Record<string, string> = {
  Virgil: "Virgil-Regular.ttf",
  Cascadia: "CascadiaCode-Regular.ttf",
  Excalifont: "Excalifont-Regular.ttf",
  Nunito: "Nunito-Regular.ttf",
  "Lilita One": "LilitaOne-Regular.ttf",
  "Comic Shanns": "ComicShanns-Regular.ttf",
  "Liberation Sans": "LiberationSans-Regular.ttf",
};

/** Thrown when `mcp-server/fonts/` is missing entirely (a corrupted checkout/package, not a normal runtime condition). */
export class FontAssetsMissingError extends Error {
  constructor(expectedDir: string) {
    super(
      `excalidash-mcp: font assets directory not found at ${expectedDir}. The ` +
        "resvg render engine needs the bundled Excalidraw TTF files there; reinstall " +
        "or reclone the package.",
    );
    this.name = "FontAssetsMissingError";
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

function fontsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(findPackageRoot(here), "fonts");
}

let cachedFontFilePaths: string[] | undefined;

/**
 * Absolute paths to every bundled Excalidraw TTF, in a stable order — passed
 * straight to `Resvg`'s `font.fontFiles`. Cached after the first (existence-
 * checked) call.
 */
export function getFontFilePaths(): string[] {
  if (cachedFontFilePaths) return cachedFontFilePaths;

  const dir = fontsDir();
  if (!existsSync(dir)) {
    throw new FontAssetsMissingError(dir);
  }
  const available = new Set(readdirSync(dir));
  const paths = Object.values(FONT_FILES_BY_FAMILY_NAME)
    .filter((fileName) => available.has(fileName))
    .map((fileName) => path.join(dir, fileName));

  cachedFontFilePaths = paths;
  return paths;
}

/** Resolves a numeric `fontFamily` id to its CSS family name; falls back to the default (Excalifont, 5) name. */
export function resolveFontFamilyName(fontFamily: number): string {
  return FONT_FAMILY_NAMES[fontFamily] ?? FONT_FAMILY_NAMES[5];
}

/** Test-only escape hatch: forces re-resolution of the fonts directory on the next `getFontFilePaths()` call. */
export function resetFontCacheForTests(): void {
  cachedFontFilePaths = undefined;
}
