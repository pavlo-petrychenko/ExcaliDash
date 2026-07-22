/**
 * T8 acceptance check: "guide tool returns each topic" — now that
 * `skills/excalidash-diagrams/references/*.md` exist (T8), `excalidash_guide`
 * should serve their real content, not the "not written yet" placeholder
 * `guide.ts` falls back to when a reference file is missing.
 */
import { describe, expect, it } from "vitest";
import { routedResponder, startHarness, type Harness } from "./testHarness.test-util.js";

async function callGuide(topic: string): Promise<string> {
  const harness = await startHarness(routedResponder({}));
  try {
    const result = await harness.client.callTool({ name: "excalidash_guide", arguments: { topic } });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe("text");
    return content[0]!.text!;
  } finally {
    await harness.close();
  }
}

describe("excalidash_guide serves the real T8 reference content", () => {
  it("topic:'schema' returns the element schema reference, not a placeholder", async () => {
    const text = await callGuide("schema");
    expect(text).not.toMatch(/not written yet/);
    expect(text).toContain("DiagramSpec");
    expect(text).toContain("convertToExcalidrawElements");
  });

  it("topic:'style' returns the palette hex values", async () => {
    const text = await callGuide("style");
    expect(text).not.toMatch(/not written yet/);
    expect(text).toContain("#a5d8ff");
    expect(text).toContain("#ffec99");
  });

  it("topic:'layout' returns the layout recipes", async () => {
    const text = await callGuide("layout");
    expect(text).not.toMatch(/not written yet/);
    expect(text.toLowerCase()).toContain("barycenter");
  });

  it("topic:'examples' returns all four worked examples", async () => {
    const text = await callGuide("examples");
    expect(text).not.toMatch(/not written yet/);
    for (const marker of ["Password Reset", "Web Service Architecture", "Ticket Priority Triage", "Fetch User Profile"]) {
      expect(text).toContain(marker);
    }
  });

  it("topic:'all' (default) concatenates every section", async () => {
    const text = await callGuide("all");
    expect(text).toContain("DiagramSpec");
    expect(text).toContain("#a5d8ff");
    expect(text.toLowerCase()).toContain("barycenter");
    expect(text).toContain("Password Reset");
  });
});
