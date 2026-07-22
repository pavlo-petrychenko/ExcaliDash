/**
 * `excalidash_guide` (plan §2.8): readOnly, in-band reference. Serves
 * `skills/excalidash-diagrams/references/*.md` content directly so the exact
 * element schema/palette/spacing constants/layout recipes are available
 * cheaply without bloating `SKILL.md`'s body (plan §6). Those reference files
 * are authored by T8 — this tool works today (returns an actionable "not
 * written yet" note per missing file) and starts serving real content the
 * moment T8 lands, with no code change needed here.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { GuideInputSchema, type GuideInput } from "../schemas/tools.js";
import { runLocalTool, textResult } from "./shared.js";

type Topic = GuideInput["topic"];

const REFERENCE_FILES: Record<Exclude<Topic, "all" | "examples">, string> = {
  schema: "element-schema.md",
  style: "style-guide.md",
  layout: "layout-recipes.md",
};

export function registerGuideTool(server: McpServer): void {
  server.registerTool(
    "excalidash_guide",
    {
      title: "ExcaliDash diagram authoring guide",
      description:
        "Returns the exact element schema, color/style palette, spacing constants, and layout recipes for authoring " +
        "clean diagrams — read this instead of guessing at field names or hex colors. topic:'all' (default) returns " +
        "everything; pick a narrower topic to save tokens once you know what you need.",
      inputSchema: GuideInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    runLocalTool(async (input: GuideInput) => {
      const referencesDir = findReferencesDir();
      const sections = await loadSections(referencesDir, input.topic);
      return textResult(clampToCharacterLimit(sections.join("\n\n---\n\n")));
    }),
  );
}

async function loadSections(referencesDir: string, topic: Topic): Promise<string[]> {
  const sections: string[] = [];
  const wantsAll = topic === "all";

  for (const [key, filename] of Object.entries(REFERENCE_FILES) as Array<[Exclude<Topic, "all" | "examples">, string]>) {
    if (wantsAll || topic === key) sections.push(await loadFile(path.join(referencesDir, filename)));
  }
  if (wantsAll || topic === "examples") {
    sections.push(...(await loadExamples(path.join(referencesDir, "examples"))));
  }
  return sections;
}

async function loadFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return `(${path.basename(filePath)} not written yet — see mcp-server/skills/excalidash-diagrams/references/.)`;
  }
}

async function loadExamples(examplesDir: string): Promise<string[]> {
  if (!existsSync(examplesDir)) {
    return ["(examples/ not written yet — see mcp-server/skills/excalidash-diagrams/references/examples/.)"];
  }
  const entries = await readdir(examplesDir);
  const markdownFiles = entries.filter((entry) => entry.endsWith(".md")).sort();
  if (markdownFiles.length === 0) return ["(no example files yet.)"];
  return Promise.all(markdownFiles.map((entry) => loadFile(path.join(examplesDir, entry))));
}

function clampToCharacterLimit(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT)}\n\n(truncated at ${CHARACTER_LIMIT} chars — request a narrower topic for the rest.)`;
}

function findReferencesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) {
      return path.join(dir, "skills", "excalidash-diagrams", "references");
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`excalidash-mcp: could not locate package.json above ${here}`);
    dir = parent;
  }
}
