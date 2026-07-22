/**
 * Pixel-budget clamp (plan §4-render `clamp.ts`): rendered images always come
 * back as a native image block, never re-encoded as base64 text, so token cost
 * tracks pixels directly. This computes the single uniform scale factor that
 * keeps the longest output side within `maxLongSide`, given the scene's natural
 * (unscaled) bounding-box size and the caller's requested `scale`.
 */

export interface ClampInput {
  /** Natural (unscaled, `scale:1`) width/height of the full export, e.g. from `exportToSvg`'s output `<svg>`. */
  naturalWidth: number;
  naturalHeight: number;
  /** Caller-requested zoom factor before clamping (plan §2.3 `scale`, default 1). */
  scale?: number;
  /** Longest-side pixel ceiling (plan §2.3 `max_width`, default `DEFAULT_MAX_LONG_SIDE`). */
  maxLongSide: number;
}

export interface ClampResult {
  /** Final scale factor to apply (≤ requested `scale`) so the longest side never exceeds `maxLongSide`. */
  scale: number;
  /** Final pixel dimensions after applying `scale`. */
  width: number;
  height: number;
  /** True when the requested scale had to be reduced to satisfy `maxLongSide`. */
  clamped: boolean;
}

/** Thrown for a scene with zero/negative natural dimensions (nothing to render). */
export class ClampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClampError";
  }
}

export function clampDimensions(input: ClampInput): ClampResult {
  const { naturalWidth, naturalHeight, maxLongSide } = input;
  const requestedScale = input.scale ?? 1;

  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    throw new ClampError(`Cannot render a scene with non-positive dimensions (${naturalWidth}x${naturalHeight}).`);
  }
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
    throw new ClampError(`scale must be a positive number (got ${input.scale}).`);
  }
  if (!Number.isFinite(maxLongSide) || maxLongSide <= 0) {
    throw new ClampError(`maxLongSide must be a positive number (got ${maxLongSide}).`);
  }

  const naturalLongSide = Math.max(naturalWidth, naturalHeight);
  const requestedLongSide = naturalLongSide * requestedScale;
  const finalScale = requestedLongSide > maxLongSide ? maxLongSide / naturalLongSide : requestedScale;

  return {
    scale: finalScale,
    width: Math.max(1, Math.round(naturalWidth * finalScale)),
    height: Math.max(1, Math.round(naturalHeight * finalScale)),
    clamped: finalScale < requestedScale,
  };
}
