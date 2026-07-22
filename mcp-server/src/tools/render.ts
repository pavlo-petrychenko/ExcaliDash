/**
 * `excalidash_render` (plan §2.3): readOnly, idempotent — the "look" half of
 * the render→look→fix loop. Delegates the actual pipeline to
 * `render/pipeline.ts`; this file only maps tool input → pipeline input and
 * pipeline output → a `CallToolResult` (native image block for `format:"png"`,
 * text for `format:"svg"` — plan: "svg returned as text/resource, not inline").
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDrawing } from "../api/drawings.js";
import { CHARACTER_LIMIT, DEFAULT_MAX_LONG_SIDE } from "../constants.js";
import { renderDrawing } from "../render/pipeline.js";
import { RenderInputSchema, type RenderInput } from "../schemas/tools.js";
import { idWithName, imageResult, runTool, textResult } from "./shared.js";

export function registerRenderTool(server: McpServer): void {
  server.registerTool(
    "excalidash_render",
    {
      title: "Render an ExcaliDash drawing to an image",
      description:
        "Renders a drawing (or a region/element_ids/frame subset of it) to a PNG image block you can actually look at. " +
        "Coordinates are top-left origin, y grows down, units are px. Use this after create/edit (or set render:true on " +
        "those tools) to verify the result — actually look at overlaps, crossed arrows, clipped text, off-canvas " +
        "elements — and fix what's wrong. max_width clamps the longest output side (token cost tracks pixels, not " +
        "bytes); use a region/element_ids render to zoom into part of a large diagram cheaply instead of re-rendering " +
        "everything.",
      inputSchema: RenderInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    runTool(async (input: RenderInput, client) => {
      const drawing = await getDrawing(client, input.drawing_id);
      const result = await renderDrawing({
        elements: drawing.elements,
        files: drawing.files,
        appState: drawing.appState,
        mode: input.mode,
        region: input.region,
        elementIds: input.element_ids,
        frameId: input.frame_id,
        scale: input.scale,
        maxLongSide: input.max_width ?? DEFAULT_MAX_LONG_SIDE,
        background: input.background,
      });

      const caption = buildCaption(idWithName(drawing.id, drawing.name), input.mode, result);
      if (input.format === "svg") {
        return textResult(`${caption}\n\n${clampSvgForText(result.svg ?? "<no svg produced>")}`);
      }
      return imageResult(result.png, caption);
    }),
  );
}

function buildCaption(
  drawingLabel: string,
  mode: RenderInput["mode"],
  result: Awaited<ReturnType<typeof renderDrawing>>,
): string {
  const lines = [`Rendered ${drawingLabel} (mode: ${mode}): ${result.width}x${result.height}px, ${result.elementCount} element(s).`];
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function clampSvgForText(svg: string): string {
  if (svg.length <= CHARACTER_LIMIT) return svg;
  return `${svg.slice(0, CHARACTER_LIMIT)}\n<!-- truncated: svg exceeded ${CHARACTER_LIMIT} chars; use format:"png" or a smaller region/element_ids selection. -->`;
}
