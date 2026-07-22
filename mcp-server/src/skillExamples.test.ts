/**
 * T8 acceptance check ("examples are valid specs that normalize + render
 * clean"): every worked example under
 * `skills/excalidash-diagrams/references/examples/*.md` embeds exactly one
 * ```json DiagramSpec code block. This test extracts each one, runs it
 * through the exact same pipeline a real tool call would (DiagramSpecSchema
 * → scene/spec.ts → scene/normalize.ts → the resvg render backend), and
 * asserts it validates, normalizes without errors or overflow warnings, and
 * renders a non-blank PNG. This keeps the skill's own examples honest — if a
 * future constants/layout change breaks one, this test fails loudly instead
 * of the skill silently teaching a broken pattern.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DiagramSpecSchema } from "./schemas/spec.js";
import { specToSkeleton } from "./scene/spec.js";
import { normalizeSkeleton } from "./scene/normalize.js";
import { createResvgBackend } from "./render/resvg.js";
import { decodePngForTests, nonBackgroundPixelRatio } from "./render/pngTestSupport.test-util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, "..", "skills", "excalidash-diagrams", "references", "examples");

function extractJsonBlock(markdown: string, filename: string): unknown {
  const match = /```json\n([\s\S]*?)\n```/.exec(markdown);
  if (!match) throw new Error(`${filename}: no \`\`\`json code block found`);
  return JSON.parse(match[1]!);
}

const exampleFiles = readdirSync(examplesDir)
  .filter((entry) => entry.endsWith(".md"))
  .sort();

describe("skill examples (skills/excalidash-diagrams/references/examples)", () => {
  it("found the expected worked examples", () => {
    expect(exampleFiles).toEqual(
      expect.arrayContaining(["flowchart.md", "architecture.md", "decision-tree.md", "sequence.md"]),
    );
  });

  for (const filename of exampleFiles) {
    it(`${filename}: parses as a valid DiagramSpec, normalizes cleanly, and renders a non-blank PNG`, async () => {
      const markdown = readFileSync(path.join(examplesDir, filename), "utf8");
      const raw = extractJsonBlock(markdown, filename);

      const spec = DiagramSpecSchema.parse(raw);
      const { skeleton } = specToSkeleton(spec);
      expect(skeleton.length).toBeGreaterThan(0);

      const { elements, warnings } = await normalizeSkeleton(skeleton);
      const overflowWarnings = warnings.filter((warning) => warning.includes("overflow"));
      expect(overflowWarnings, `unexpected overflow warning(s) in ${filename}: ${overflowWarnings.join(" ")}`).toEqual([]);

      const backend = createResvgBackend();
      const result = await backend.render({
        elements,
        files: {},
        appState: { viewBackgroundColor: "#ffffff", exportBackground: true },
        maxLongSide: 1200,
        background: "white",
      });

      const decoded = decodePngForTests(result.png);
      expect(nonBackgroundPixelRatio(decoded)).toBeGreaterThan(0.01);
    });
  }
});
