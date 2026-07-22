/**
 * `excalidash_create_diagram` (plan §2.4): write, not idempotent, not
 * destructive — the crown jewel. Accepts exactly one of `spec` (ergonomic
 * default)/`skeleton` (power user)/`elements` (escape hatch), normalizes+
 * validates it through the one choke point (`scene/normalize.ts`), persists it,
 * and — by default — renders a PNG back so the agent sees its own work in the
 * same turn (the render→look→fix loop).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDrawing } from "../api/drawings.js";
import { DEFAULT_MAX_LONG_SIDE } from "../constants.js";
import { renderDrawing } from "../render/pipeline.js";
import { normalizeElements, normalizeSkeleton } from "../scene/normalize.js";
import type { ExcalidrawElementSkeleton, OrderedExcalidrawElement } from "../scene/excalidrawVendor.js";
import { specToSkeleton } from "../scene/spec.js";
import { CreateDiagramInputSchema, type CreateDiagramInput } from "../schemas/tools.js";
import { idWithName, imageResult, runTool, textResult } from "./shared.js";

const DEFAULT_VIEW_BACKGROUND_COLOR = "#ffffff";

export function registerCreateDiagramTool(server: McpServer): void {
  server.registerTool(
    "excalidash_create_diagram",
    {
      title: "Create an ExcaliDash diagram",
      description:
        "Creates a new drawing. Provide exactly one of: spec (nodes + edges + a layout strategy — the recommended " +
        "default; auto-layout positions everything, arrows bind to nodes by id), skeleton (an " +
        "ExcalidrawElementSkeleton[] for full manual control of shapes/positions), or elements (a raw, already-" +
        "complete elements array — an escape hatch, e.g. round-tripped from excalidash_get_drawing). Coordinates are " +
        "top-left origin, y grows down, units px. Returns the new drawing's id/version plus (by default) a PNG render " +
        "— actually look at it and call excalidash_edit_diagram to fix overlaps/crossings/clipped text before moving on.",
      inputSchema: CreateDiagramInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    runTool(async (input: CreateDiagramInput, client) => {
      const normalized = await resolveElements(input);
      const appState = buildAppState(input);

      const created = await createDrawing(client, {
        name: input.name,
        collectionId: input.collection_id ?? null,
        elements: normalized.elements,
        appState,
        files: input.files ?? null,
      });

      const summary = buildSummary(created.id, created.name, created.version, normalized.warnings);
      if (!input.render) return textResult(summary);

      const rendered = await renderDrawing({
        elements: normalized.elements,
        files: input.files ?? null,
        appState,
        mode: "full",
        scale: input.render_scale,
        maxLongSide: DEFAULT_MAX_LONG_SIDE,
        background: "white",
      });
      return imageResult(rendered.png, summary);
    }),
  );
}

async function resolveElements(input: CreateDiagramInput): Promise<{ elements: OrderedExcalidrawElement[]; warnings: string[] }> {
  if (input.spec) {
    const { skeleton } = specToSkeleton(input.spec);
    return normalizeSkeleton(skeleton);
  }
  if (input.skeleton) {
    return normalizeSkeleton(input.skeleton as ExcalidrawElementSkeleton[]);
  }
  return normalizeElements(input.elements!);
}

function buildAppState(input: CreateDiagramInput): Record<string, unknown> {
  return {
    viewBackgroundColor: input.app_state?.viewBackgroundColor ?? input.background_color ?? DEFAULT_VIEW_BACKGROUND_COLOR,
    ...(input.app_state?.gridSize !== undefined ? { gridSize: input.app_state.gridSize } : {}),
  };
}

function buildSummary(id: string, name: string, version: number, warnings: readonly string[]): string {
  const lines = [`Created ${idWithName(id, name)}, version ${version}.`];
  for (const warning of warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}
