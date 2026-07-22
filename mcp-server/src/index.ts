#!/usr/bin/env node
/**
 * Entry point: env validation + stdio transport wiring ONLY (kept isolated so a
 * future MCP SDK v2 migration is a small, contained diff — see plan §1).
 *
 * stdout is reserved for JSON-RPC on stdio; ALL logging here goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { createServer, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `excalidash-mcp ${SERVER_VERSION} running (stdio; base=${config.baseUrl}; render=${config.renderEngine})`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`excalidash-mcp: ${error.message}`);
  } else {
    console.error("excalidash-mcp: fatal error during startup", error);
  }
  process.exit(1);
});
