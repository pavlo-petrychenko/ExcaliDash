/**
 * `DiagramSpec` — the ergonomic default authoring input for `excalidash_create_diagram`
 * / `excalidash_edit_diagram` (plan §4.4, §0.2 #6): the agent describes nodes + edges
 * + a layout strategy, and `scene/spec.ts` + `scene/layout.ts` turn that into a laid-out
 * `ExcalidrawElementSkeleton[]` which then goes through the one normalization choke
 * point (`scene/normalize.ts`, T4). `skeleton`/`elements` remain the power-user/escape
 * hatches (T7 wires all three as tool input alternatives).
 *
 * Every field carries a `.describe()` — these strings are what an agent actually reads
 * when deciding how to call the tool, so they state conventions and defaults inline
 * (plan §2: "as if to a new teammate"). The whole schema is `.strict()` so unknown
 * fields the agent invents (e.g. guessing at `x`/`y` when a `flow` layout is requested)
 * fail fast with a zod error instead of being silently ignored.
 *
 * Deviation from the plan's literal §4.4 code block: that snippet omits `x`/`y` on the
 * node object, but §4.5 explicitly requires `layout.type:"manual"` to "require x/y per
 * node; validate presence" — which is impossible without a place to put them. This
 * schema adds `x`/`y` as optional node fields (required only when `layout.type` is
 * `"manual"`, enforced by `scene/layout.ts`, not by zod, since zod can't easily express
 * "required iff sibling field elsewhere in the tree equals X").
 */
import { z } from "zod";
import {
  DEFAULT_LAYOUT_SPACING_X,
  DEFAULT_LAYOUT_SPACING_Y,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
} from "../constants.js";

export const NodeShapeSchema = z.enum(["rectangle", "ellipse", "diamond"]);
export type NodeShape = z.infer<typeof NodeShapeSchema>;

export const NodeRoleSchema = z.enum(["process", "decision", "terminator", "data", "accent"]);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

export const EdgeStyleSchema = z.enum(["solid", "dashed", "dotted"]);
export type EdgeStyle = z.infer<typeof EdgeStyleSchema>;

export const ArrowheadSchema = z.enum(["arrow", "triangle", "none"]);
export type ArrowheadStyle = z.infer<typeof ArrowheadSchema>;

export const LayoutTypeSchema = z.enum(["flow", "grid", "manual"]);
export type LayoutType = z.infer<typeof LayoutTypeSchema>;

export const LayoutDirectionSchema = z.enum(["down", "right"]);
export type LayoutDirection = z.infer<typeof LayoutDirectionSchema>;

export const DiagramNodeSchema = z
  .object({
    id: z.string().min(1).describe("Stable id you choose; edges and other ops reference nodes by this id."),
    label: z.string().describe("Text shown inside the node."),
    shape: NodeShapeSchema.default("rectangle").describe(
      "rectangle=process, diamond=decision, ellipse=start/end (convention). Also picks the default fill color when role/color are unset.",
    ),
    role: NodeRoleSchema.optional().describe(
      "Picks a curated background color for this node; overrides the shape's default color. Does not change the shape itself.",
    ),
    color: z.string().optional().describe("Explicit background hex (e.g. '#a5d8ff'); overrides both role and shape default."),
    group: z.string().optional().describe("Nodes sharing the same group string are placed adjacent to each other by auto-layout."),
    frame: z.string().optional().describe("Name of a frame to place this node in; a frame box is drawn around all nodes sharing a name."),
    width: z.number().positive().optional().describe(`Node box width in px (default ${DEFAULT_NODE_WIDTH}).`),
    height: z.number().positive().optional().describe(`Node box height in px (default ${DEFAULT_NODE_HEIGHT}).`),
    x: z
      .number()
      .optional()
      .describe("Explicit x position in px. Required for every node when layout.type is 'manual'; ignored otherwise."),
    y: z
      .number()
      .optional()
      .describe("Explicit y position in px. Required for every node when layout.type is 'manual'; ignored otherwise."),
  })
  .strict();
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;

export const DiagramEdgeSchema = z
  .object({
    from: z.string().min(1).describe("Source node id (must match a node's id)."),
    to: z.string().min(1).describe("Target node id (must match a node's id)."),
    label: z.string().optional().describe("Text shown alongside the arrow."),
    style: EdgeStyleSchema.default("solid").describe("Line style of the arrow."),
    arrowhead: ArrowheadSchema.default("arrow").describe("Arrowhead style at the 'to' end; 'none' draws a plain line-like connector."),
  })
  .strict();
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;

export const DiagramLayoutSchema = z
  .object({
    type: LayoutTypeSchema.default("flow").describe(
      "flow=auto layered layout following edges (recommended for processes/flowcharts); " +
        "grid=wrap nodes into a uniform grid (recommended for unrelated/parallel items); " +
        "manual=you set x/y on every node yourself.",
    ),
    direction: LayoutDirectionSchema.default("down").describe(
      "Only used by layout.type:'flow'. 'down'=ranks stack top-to-bottom (default, reads like a flowchart); 'right'=ranks stack left-to-right.",
    ),
    spacingX: z.number().nonnegative().default(DEFAULT_LAYOUT_SPACING_X).describe("Horizontal gap in px between adjacent node boxes."),
    spacingY: z.number().nonnegative().default(DEFAULT_LAYOUT_SPACING_Y).describe("Vertical gap in px between adjacent node boxes."),
  })
  .strict();
export type DiagramLayout = z.infer<typeof DiagramLayoutSchema>;

export const DiagramThemeSchema = z.enum(["light", "dark"]);
export type DiagramTheme = z.infer<typeof DiagramThemeSchema>;

export const DiagramSpecSchema = z
  .object({
    title: z.string().optional().describe("Optional heading text placed above the diagram."),
    nodes: z.array(DiagramNodeSchema).min(1).describe("The boxes/shapes of the diagram. At least one is required."),
    edges: z.array(DiagramEdgeSchema).default([]).describe("Arrows connecting nodes by id. Order does not affect layout determinism."),
    layout: DiagramLayoutSchema.default({}).describe("How node positions are computed. See each field's own description."),
    theme: DiagramThemeSchema.default("light").describe("Cosmetic theme hint; currently informational (does not change colors)."),
  })
  .strict();
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;
