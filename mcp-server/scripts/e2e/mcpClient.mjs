/**
 * Spawns the REAL built `excalidash-mcp` server (`dist/index.js`) as a stdio
 * subprocess and connects an MCP SDK `Client` to it — this is the one place
 * the e2e harness differs from the unit tests' `testHarness.test-util.ts`
 * in-memory-transport + faked-`fetch` approach: here nothing is faked, the
 * client talks real JSON-RPC over stdio to a real process that talks real
 * HTTP to the ephemeral backend started by `backend.mjs`.
 */
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_SERVER_ENTRY } from "./paths.mjs";

/**
 * Connects a fresh MCP client/server pair for one API key. `label` is only
 * used in error messages (e.g. "full-scope", "read-only").
 */
export async function connectMcpClient(label, { apiKey, baseUrl }) {
  if (!fs.existsSync(MCP_SERVER_ENTRY)) {
    throw new Error(`${MCP_SERVER_ENTRY} does not exist — run \`npm run build\` in mcp-server/ before the e2e harness.`);
  }

  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.EXCALIDASH_API_KEY = apiKey;
  env.EXCALIDASH_BASE_URL = baseUrl;
  env.EXCALIDASH_ALLOW_INSECURE = "true";

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRY],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: `excalidash-mcp-e2e-${label}`, version: "0.0.1" });

  const stderrChunks = [];
  // `transport.stderr` is only non-null once `start()` has spawned the child process, which
  // `client.connect()` does internally — attach right after (Node buffers a Readable's data
  // until a listener is attached, so this doesn't race the child's earliest output).
  await client.connect(transport);
  transport.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

  return {
    client,
    /** Calls a tool and throws with the server's stderr attached if the call itself throws (not `isError:true` results). */
    async callTool(name, args) {
      try {
        return await client.callTool({ name, arguments: args });
      } catch (error) {
        error.message += `\n--- excalidash-mcp (${label}) stderr ---\n${Buffer.concat(stderrChunks).toString("utf8")}`;
        throw error;
      }
    },
    async close() {
      await client.close();
    },
  };
}
