import { describe, expect, it } from "vitest";
import { clampDimensions, ClampError } from "./clamp.js";

describe("clampDimensions", () => {
  it("leaves dimensions untouched when already within maxLongSide", () => {
    const result = clampDimensions({ naturalWidth: 400, naturalHeight: 300, maxLongSide: 1200 });
    expect(result).toEqual({ scale: 1, width: 400, height: 300, clamped: false });
  });

  it("scales down uniformly when the requested (scale 1) size exceeds maxLongSide", () => {
    const result = clampDimensions({ naturalWidth: 2000, naturalHeight: 1000, maxLongSide: 1000 });
    expect(result.clamped).toBe(true);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(500);
    expect(result.scale).toBeCloseTo(0.5, 5);
  });

  it("clamps a scale:2 request whose result would exceed maxLongSide", () => {
    const result = clampDimensions({ naturalWidth: 400, naturalHeight: 300, scale: 2, maxLongSide: 600 });
    // natural longest side 400 * scale 2 = 800 > 600 -> clamp to 600/400 = 1.5
    expect(result.scale).toBeCloseTo(1.5, 5);
    expect(result.width).toBe(600);
    expect(result.height).toBe(450);
    expect(result.clamped).toBe(true);
  });

  it("passes through a sub-1 requested scale unclamped", () => {
    const result = clampDimensions({ naturalWidth: 400, naturalHeight: 300, scale: 0.5, maxLongSide: 1200 });
    expect(result.scale).toBe(0.5);
    expect(result.width).toBe(200);
    expect(result.height).toBe(150);
    expect(result.clamped).toBe(false);
  });

  it("rounds pixel dimensions and never returns zero", () => {
    const result = clampDimensions({ naturalWidth: 10, naturalHeight: 3, scale: 0.01, maxLongSide: 1200 });
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("rejects non-positive natural dimensions", () => {
    expect(() => clampDimensions({ naturalWidth: 0, naturalHeight: 100, maxLongSide: 1200 })).toThrow(ClampError);
    expect(() => clampDimensions({ naturalWidth: 100, naturalHeight: -5, maxLongSide: 1200 })).toThrow(ClampError);
  });

  it("rejects a non-positive scale", () => {
    expect(() => clampDimensions({ naturalWidth: 100, naturalHeight: 100, scale: 0, maxLongSide: 1200 })).toThrow(
      ClampError,
    );
  });

  it("rejects a non-positive maxLongSide", () => {
    expect(() => clampDimensions({ naturalWidth: 100, naturalHeight: 100, maxLongSide: -1 })).toThrow(ClampError);
  });
});
