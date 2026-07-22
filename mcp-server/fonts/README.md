# Bundled font assets (resvg render engine)

These `.ttf` files are the Excalidraw font families, pre-converted from the
woff2 files `@excalidraw/excalidraw@0.18.1` ships in `dist/prod/fonts/**`, and
fed to `@resvg/resvg-js` as `font.fontFiles` by `src/render/fonts.ts`.

## Why TTF, and why committed as binary assets

`@resvg/resvg-js`'s bundled `fontdb` does not reliably parse the Excalidraw
woff2 files — every one of them fails to load with `"malformed font"` — and
its public API only accepts local font files/dirs (`font.fontFiles`/
`font.fontDirs`), not in-memory buffers, in the pinned `@resvg/resvg-js`
version. Excalidraw's `glyf`/`loca` tables in these woff2 files are also
WOFF2-*transformed* (not a straight compressed copy), so a full from-scratch
decoder is a nontrivial reimplementation of Google's `woff2` C++ transform-
reconstruction algorithm.

These `.ttf` files were produced **once**, as a build-time asset-generation
step (analogous to `dist/vendor/excalidraw-core.mjs` — a prebuilt artifact,
not a runtime dependency), by decompressing the largest/broadest-subset woff2
file per family with `wawoff2` (`fontello/wawoff2`, an npm-published wrapper
around Google's own `woff2_decompress`), then committing the resulting TTFs
here. `wawoff2` itself is **not** an `mcp-server` dependency — this package
never imports it at runtime.

## Regenerating

Only needed if `@excalidraw/excalidraw` is upgraded to a version with changed
font assets:

```sh
npx --yes wawoff2 --help   # confirms the tool resolves; see its decompress() API
node -e '
  const decompress = require("wawoff2/decompress.js");
  const fs = require("fs");
  (async () => {
    const buf = fs.readFileSync("<path to the .woff2 in node_modules/@excalidraw/excalidraw/dist/prod/fonts/<Family>/...>");
    const ttf = await decompress(buf);
    fs.writeFileSync("<Family>-Regular.ttf", Buffer.from(ttf));
  })();
'
```

Pick the **largest** file in each family's folder (broadest Latin/Latin-ext
glyph coverage among the per-unicode-range subset files Excalidraw ships).
`Helvetica` (`FONT_FAMILY` id 2) intentionally has no asset here — Excalidraw's
own `@font-face` for it points at the system font stack, and `src/render/resvg.ts`
sets `loadSystemFonts:true` alongside these `fontFiles` so it (and any other
family not covered here, e.g. CJK/emoji fallbacks) still degrades to a locally-
installed system font instead of failing outright.

## Files

| File | Excalidraw `fontFamily` id | Family name |
|---|---|---|
| `Excalifont-Regular.ttf` | 5 (default) | Excalifont |
| `Virgil-Regular.ttf` | 1 | Virgil |
| `CascadiaCode-Regular.ttf` | 3 | Cascadia |
| `Nunito-Regular.ttf` | 6 | Nunito |
| `LilitaOne-Regular.ttf` | 7 | Lilita One |
| `ComicShanns-Regular.ttf` | 8 | Comic Shanns |
| `LiberationSans-Regular.ttf` | 9 | Liberation Sans |
