/**
 * McpServer construction (plan §2, T7). Thin by design: every tool's schema +
 * handler lives in `tools/*.ts` (metadata + thin glue) built on `api/`,
 * `scene/`, and `render/` (T3-T6); this file only builds the server instance
 * and wires the 8 `excalidash_*` tools onto it.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCollectionsTool } from "./tools/collections.js";
import { registerCreateDiagramTool } from "./tools/createDiagram.js";
import { registerEditDiagramTool } from "./tools/editDiagram.js";
import { registerGetDrawingTool } from "./tools/getDrawing.js";
import { registerGuideTool } from "./tools/guide.js";
import { registerListDrawingsTool } from "./tools/listDrawings.js";
import { registerManageDrawingTool } from "./tools/manageDrawing.js";
import { registerRenderTool } from "./tools/render.js";

export const SERVER_NAME = "excalidash-mcp";
export const SERVER_VERSION = "0.1.0";

/** Builds the McpServer with all 8 `excalidash_*` tools registered (plan §2). */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerListDrawingsTool(server);
  registerGetDrawingTool(server);
  registerRenderTool(server);
  registerCreateDiagramTool(server);
  registerEditDiagramTool(server);
  registerManageDrawingTool(server);
  registerCollectionsTool(server);
  registerGuideTool(server);

  return server;
}
