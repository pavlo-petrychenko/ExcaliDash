#!/usr/bin/env node
/**
 * Full-lifecycle e2e harness (plan §1 `scripts/e2e-local.mjs`, §7 "Verify
 * locally before any push": `npm run build && npm test && node
 * scripts/e2e-local.mjs`, §8 T9's acceptance check).
 *
 * Starts a throwaway local ExcaliDash backend (own SQLite db under the OS tmp
 * dir, own free ports — never the developer's `make dev` database), seeds it
 * with a real full-scope and a real read-only API key, spawns the actual
 * built `dist/index.js` MCP server as a stdio subprocess for each key, and
 * drives the whole tool surface through one realistic diagram's lifecycle:
 * create -> read -> render -> edit+relayout -> history -> restore ->
 * collections -> delete, plus the read-only-key negative-scope check.
 *
 * No test framework/assertion library dependency: everything here talks to a
 * REAL backend + a REAL subprocess (unlike `src/tools/*.test.ts`'s faked-
 * `fetch` unit tests), so a plain fail-fast script with readable step output
 * is more legible than shoehorning this into vitest.
 *
 * Usage: `node scripts/e2e-local.mjs` (after `npm run build`), or
 * `npm run test:e2e`. Everything it starts is torn down in `finally`, success
 * or failure, including on Ctrl-C.
 */
import { startEphemeralBackend } from "./e2e/backend.mjs";
import { connectMcpClient } from "./e2e/mcpClient.mjs";
import { runScenario } from "./e2e/scenario.mjs";

async function main() {
  process.stdout.write("excalidash-mcp e2e: starting ephemeral local backend...\n");
  const backend = await startEphemeralBackend();
  process.stdout.write(`excalidash-mcp e2e: backend ready at ${backend.baseUrl} (log: ${backend.logPath})\n`);

  let full;
  let readOnly;
  try {
    full = await connectMcpClient("full-scope", { apiKey: backend.fullToken, baseUrl: backend.baseUrl });
    readOnly = await connectMcpClient("read-only", { apiKey: backend.readOnlyToken, baseUrl: backend.baseUrl });

    await runScenario({ full, readOnly });

    process.stdout.write("\nexcalidash-mcp e2e: all steps passed.\n");
  } finally {
    await full?.close().catch(() => {});
    await readOnly?.close().catch(() => {});
    await backend.stop().catch(() => {});
  }
}

main().catch((error) => {
  console.error("\nexcalidash-mcp e2e: FAILED");
  console.error(error);
  process.exitCode = 1;
});
