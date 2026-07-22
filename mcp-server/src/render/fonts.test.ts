import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { getFontFilePaths, resetFontCacheForTests, resolveFontFamilyName } from "./fonts.js";

describe("getFontFilePaths", () => {
  it("returns existing, non-empty TTF file paths, including Excalifont", () => {
    resetFontCacheForTests();
    const paths = getFontFilePaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(existsSync(p)).toBe(true);
      expect(p.endsWith(".ttf")).toBe(true);
    }
    expect(paths.some((p) => p.includes("Excalifont"))).toBe(true);
  });

  it("caches the result across calls", () => {
    resetFontCacheForTests();
    const first = getFontFilePaths();
    const second = getFontFilePaths();
    expect(second).toBe(first);
  });
});

describe("resolveFontFamilyName", () => {
  it("maps known FONT_FAMILY ids to their CSS name", () => {
    expect(resolveFontFamilyName(5)).toBe("Excalifont");
    expect(resolveFontFamilyName(1)).toBe("Virgil");
    expect(resolveFontFamilyName(9)).toBe("Liberation Sans");
  });

  it("falls back to the default (Excalifont) for an unknown id", () => {
    expect(resolveFontFamilyName(999)).toBe("Excalifont");
  });
});

describe("bundled Excalifont TTF actually rasterizes glyphs via resvg (T6 acceptance: \"Excalifont glyphs present\")", () => {
  it("produces visibly more non-background pixels with the font than without it", () => {
    resetFontCacheForTests();
    const fontFiles = getFontFilePaths().filter((p) => p.includes("Excalifont"));
    expect(fontFiles).toHaveLength(1);

    const svgFor = (text: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="80">` +
      `<rect width="220" height="80" fill="white"/>` +
      `<text x="10" y="45" font-family="Excalifont" font-size="28" fill="black">${text}</text></svg>`;

    const withFont = new Resvg(svgFor("Hello"), {
      font: { loadSystemFonts: false, fontFiles, defaultFontFamily: "Excalifont" },
      background: "white",
    })
      .render()
      .asPng();

    // Same text, but resvg has NO font at all to resolve "Excalifont" against —
    // this is the direct control proving the ink above comes from our bundled
    // TTF specifically, not some other fallback.
    const withoutFont = new Resvg(svgFor("Hello"), {
      font: { loadSystemFonts: false, fontFiles: [], defaultFontFamily: "Excalifont" },
      background: "white",
    })
      .render()
      .asPng();

    expect(withFont.length).toBeGreaterThan(withoutFont.length + 200);
  });
});
