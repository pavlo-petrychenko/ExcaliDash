/**
 * Minimal, dependency-free PNG decoder used ONLY by `resvg.test.ts`'s golden-image
 * assertions (the render pipeline itself never decodes its own PNG output — the
 * agent/MCP client does that). Implements just enough of the PNG spec (chunk
 * walking, zlib inflate via Node's built-in `zlib`, and the five scanline
 * filters) to read back raw 8-bit RGBA pixels and assert "this PNG actually has
 * ink in it, not just a blank background" without adding an image-decoding
 * dependency to the package.
 *
 * Named `*.test-util.ts` (not `*.test.ts`) so vitest's `include` glob
 * (`src/**\/*.test.ts`) doesn't try to run it as its own (assertion-less) suite.
 */
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Bytes per pixel (assumes 8-bit depth, the only depth resvg/browser engines emit). */
  bytesPerPixel: number;
  /** Row-major, top-to-bottom, unfiltered raw samples (`height * width * bytesPerPixel` bytes). */
  pixels: Buffer;
}

export function decodePngForTests(buffer: Buffer): DecodedPng {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file (bad signature).");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + 4; // + CRC

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`decodePngForTests only supports 8-bit PNGs (got bitDepth=${bitDepth}).`);
  }
  const bytesPerPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!bytesPerPixel) {
    throw new Error(`Unsupported PNG colorType ${colorType}.`);
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const pixels = unfilterScanlines(raw, width, height, bytesPerPixel);
  return { width, height, bitDepth, colorType, bytesPerPixel, pixels };
}

function unfilterScanlines(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;

  for (let y = 0; y < height; y++) {
    const filterType = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos + x];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevRowStart + x] : 0;
      const c = y > 0 && x >= bpp ? out[prevRowStart + x - bpp] : 0;
      out[rowStart + x] = applyFilter(filterType, rawByte, a, b, c);
    }
    pos += stride;
  }
  return out;
}

function applyFilter(filterType: number, rawByte: number, a: number, b: number, c: number): number {
  switch (filterType) {
    case 0:
      return rawByte;
    case 1:
      return (rawByte + a) & 0xff;
    case 2:
      return (rawByte + b) & 0xff;
    case 3:
      return (rawByte + Math.floor((a + b) / 2)) & 0xff;
    case 4:
      return (rawByte + paethPredictor(a, b, c)) & 0xff;
    default:
      throw new Error(`Unsupported PNG scanline filter type ${filterType}.`);
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Fraction of pixels whose RGB differs meaningfully from `background` (default white) — a cheap "has ink" proxy. */
export function nonBackgroundPixelRatio(decoded: DecodedPng, background: [number, number, number] = [255, 255, 255]): number {
  const { pixels, bytesPerPixel, width, height } = decoded;
  let inkPixels = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const offset = i * bytesPerPixel;
    const r = pixels[offset];
    const g = bytesPerPixel > 1 ? pixels[offset + 1] : r;
    const b = bytesPerPixel > 2 ? pixels[offset + 2] : r;
    const distance = Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]);
    if (distance > 30) inkPixels++;
  }
  return inkPixels / total;
}
