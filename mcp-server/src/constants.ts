/**
 * Hard limits and defaults shared across tools, api client, and renderer.
 *
 * Palette and layout-spacing constants (node size, gaps) below back the
 * DiagramSpec/auto-layout work (scene/spec.ts, scene/layout.ts) — plan §4.4/§4.5.
 */

/** Max characters returned in a single tool text response before truncation kicks in. */
export const CHARACTER_LIMIT = 25000;

/** Max elements allowed in a scene; mirrors the backend's own cap (see plan §4.3). */
export const MAX_ELEMENTS = 10000;

/** Default longest-side pixel clamp for rendered images (token cost tracks pixels, not bytes). */
export const DEFAULT_MAX_LONG_SIDE = 1200;

/** Default/maximum page size for list tools' pagination envelope. */
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

/** Default HTTP request timeout (ms) for calls to the ExcaliDash backend. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Default ExcaliDash backend base URL when EXCALIDASH_BASE_URL is not set. */
export const DEFAULT_BASE_URL = "https://excalidraw.pavlop.dev";

/**
 * DiagramSpec default node box size (plan §4.4/§4.5/§6.5: "node 180×80, gaps
 * 120/100") and default label font size. Used by `scene/spec.ts` when a node
 * doesn't specify its own `width`/`height`.
 */
export const DEFAULT_NODE_WIDTH = 180;
export const DEFAULT_NODE_HEIGHT = 80;
export const DEFAULT_NODE_LABEL_FONT_SIZE = 20;

/** Default auto-layout gaps between node boxes (plan §4.5), in px. */
export const DEFAULT_LAYOUT_SPACING_X = 120;
export const DEFAULT_LAYOUT_SPACING_Y = 100;

/** Title text: font size and the gap left between it and the laid-out diagram body. */
export const TITLE_FONT_SIZE = 28;
export const TITLE_GAP = 24;

/**
 * Curated background-color palette per `DiagramSpec` node `role` (plan §4.4:
 * "Picks a curated palette color"). Values are Excalidraw's own default
 * background swatches (`open-color`, shade index 1) so diagrams match the
 * app's native look — see research 07 (`DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE`).
 */
export const ROLE_PALETTE: Record<"process" | "decision" | "terminator" | "data" | "accent", string> = {
  process: "#a5d8ff", // blue
  decision: "#ffec99", // yellow
  terminator: "#b2f2bb", // green
  data: "#eebefa", // violet
  accent: "#ffc9c9", // red
};

/**
 * Shape → default role, used when a node sets `shape` but no explicit `role`/
 * `color` (plan §4.4 describe text: "rectangle=process, diamond=decision,
 * ellipse=start/end (convention)"). `ellipse` uses the `terminator` role.
 */
export const SHAPE_DEFAULT_ROLE: Record<"rectangle" | "ellipse" | "diamond", keyof typeof ROLE_PALETTE> = {
  rectangle: "process",
  diamond: "decision",
  ellipse: "terminator",
};
