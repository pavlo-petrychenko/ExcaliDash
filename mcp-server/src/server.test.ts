import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const EXPECTED_TOOL_NAMES = [
  "excalidash_list_drawings",
  "excalidash_get_drawing",
  "excalidash_render",
  "excalidash_create_diagram",
  "excalidash_edit_diagram",
  "excalidash_manage_drawing",
  "excalidash_collections",
  "excalidash_guide",
];

interface ListedTool {
  name: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

describe("createServer", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  async function connect() {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "0.0.1" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it("registers exactly the 8 excalidash_* tools from plan §2", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it.each(["excalidash_list_drawings", "excalidash_get_drawing", "excalidash_render", "excalidash_guide"])(
    "%s is annotated readOnlyHint:true",
    async (name) => {
      const c = await connect();
      const { tools } = (await c.listTools()) as { tools: ListedTool[] };
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.idempotentHint).toBe(true);
    },
  );

  it("excalidash_create_diagram is annotated readOnlyHint:false, destructiveHint:false, idempotentHint:false", async () => {
    const c = await connect();
    const { tools } = (await c.listTools()) as { tools: ListedTool[] };
    const tool = tools.find((t) => t.name === "excalidash_create_diagram")!;
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.destructiveHint).toBe(false);
    expect(tool.annotations?.idempotentHint).toBe(false);
  });

  it("excalidash_edit_diagram is annotated destructiveHint:true, idempotentHint:true", async () => {
    const c = await connect();
    const { tools } = (await c.listTools()) as { tools: ListedTool[] };
    const tool = tools.find((t) => t.name === "excalidash_edit_diagram")!;
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.idempotentHint).toBe(true);
  });

  it.each(["excalidash_manage_drawing", "excalidash_collections"])("%s is annotated destructiveHint:true", async (name) => {
    const c = await connect();
    const { tools } = (await c.listTools()) as { tools: ListedTool[] };
    const tool = tools.find((t) => t.name === name)!;
    expect(tool.annotations?.readOnlyHint).toBe(false);
    expect(tool.annotations?.destructiveHint).toBe(true);
  });

  it("every tool sets openWorldHint:true except excalidash_guide (no network)", async () => {
    const c = await connect();
    const { tools } = (await c.listTools()) as { tools: ListedTool[] };
    for (const tool of tools) {
      const expected = tool.name !== "excalidash_guide";
      expect(tool.annotations?.openWorldHint).toBe(expected);
    }
  });

  it("rejects unknown fields on a tool's .strict() schema", async () => {
    const c = await connect();
    const result = await c.callTool({
      name: "excalidash_guide",
      arguments: { unexpected: "field" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toMatch(/unrecognized|unexpected|invalid/i);
  });

  it("excalidash_guide responds without hitting the network (readOnly, in-band reference)", async () => {
    const c = await connect();
    const result = await c.callTool({ name: "excalidash_guide", arguments: { topic: "schema" } });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe("text");
    expect(typeof content[0]?.text).toBe("string");
  });

  it("exposes the expected server name/version via initialize", async () => {
    const server = createServer();
    expect(SERVER_NAME).toBe("excalidash-mcp");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "test-client", version: "0.0.1" });
    await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
    const serverVersion = c.getServerVersion();
    expect(serverVersion?.name).toBe(SERVER_NAME);
    expect(serverVersion?.version).toBe(SERVER_VERSION);
    await c.close();
  });
});
