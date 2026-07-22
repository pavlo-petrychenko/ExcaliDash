/**
 * Shared filesystem paths for the local e2e harness (plan §7 "verify locally
 * before any push", T9). Resolved once from this file's own location so the
 * harness works regardless of the caller's cwd.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `mcp-server/scripts/e2e` */
export const E2E_DIR = here;
/** `mcp-server/scripts` */
export const SCRIPTS_DIR = path.resolve(here, "..");
/** `mcp-server/` */
export const MCP_SERVER_DIR = path.resolve(SCRIPTS_DIR, "..");
/** repo root */
export const REPO_ROOT = path.resolve(MCP_SERVER_DIR, "..");
/** `backend/` */
export const BACKEND_DIR = path.resolve(REPO_ROOT, "backend");
/** `mcp-server/dist/index.js` — the built MCP server entry point the harness spawns over stdio. */
export const MCP_SERVER_ENTRY = path.resolve(MCP_SERVER_DIR, "dist/index.js");
