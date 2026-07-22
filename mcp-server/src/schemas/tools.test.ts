import { describe, expect, it } from "vitest";
import {
  CollectionsInputSchema,
  CreateDiagramInputSchema,
  EditDiagramInputSchema,
  GetDrawingInputSchema,
  GuideInputSchema,
  ListDrawingsInputSchema,
  ManageDrawingInputSchema,
  RenderInputSchema,
} from "./tools.js";

const MINIMAL_SPEC = { nodes: [{ id: "a", label: "A" }] };

describe("CreateDiagramInputSchema — exactly one of spec/skeleton/elements", () => {
  it("accepts spec alone", () => {
    const result = CreateDiagramInputSchema.safeParse({ name: "Flow", spec: MINIMAL_SPEC });
    expect(result.success).toBe(true);
  });

  it("accepts skeleton alone", () => {
    const result = CreateDiagramInputSchema.safeParse({ name: "Flow", skeleton: [{ type: "rectangle" }] });
    expect(result.success).toBe(true);
  });

  it("accepts elements alone", () => {
    const result = CreateDiagramInputSchema.safeParse({ name: "Flow", elements: [{ type: "rectangle" }] });
    expect(result.success).toBe(true);
  });

  it("rejects none of the three", () => {
    const result = CreateDiagramInputSchema.safeParse({ name: "Flow" });
    expect(result.success).toBe(false);
  });

  it("rejects more than one of the three", () => {
    const result = CreateDiagramInputSchema.safeParse({
      name: "Flow",
      spec: MINIMAL_SPEC,
      skeleton: [{ type: "rectangle" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level field (.strict())", () => {
    const result = CreateDiagramInputSchema.safeParse({ name: "Flow", spec: MINIMAL_SPEC, bogus_field: true });
    expect(result.success).toBe(false);
  });
});

describe("EditDiagramInputSchema — ops array", () => {
  it("accepts a well-formed add/update/delete op list", () => {
    const result = EditDiagramInputSchema.safeParse({
      drawing_id: "d1",
      ops: [
        { action: "add", spec: MINIMAL_SPEC },
        { action: "update", id: "a", patch: { backgroundColor: "#fff" } },
        { action: "delete", ids: ["a"] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an 'add' op with none of spec/skeleton/elements", () => {
    const result = EditDiagramInputSchema.safeParse({ drawing_id: "d1", ops: [{ action: "add" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an 'add' op with more than one of spec/skeleton/elements", () => {
    const result = EditDiagramInputSchema.safeParse({
      drawing_id: "d1",
      ops: [{ action: "add", spec: MINIMAL_SPEC, elements: [{ type: "rectangle" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a 'replace_all' op with none of spec/skeleton/elements", () => {
    const result = EditDiagramInputSchema.safeParse({ drawing_id: "d1", ops: [{ action: "replace_all" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty ops array", () => {
    const result = EditDiagramInputSchema.safeParse({ drawing_id: "d1", ops: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a delete op with an empty ids array", () => {
    const result = EditDiagramInputSchema.safeParse({ drawing_id: "d1", ops: [{ action: "delete", ids: [] }] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown action literal", () => {
    const result = EditDiagramInputSchema.safeParse({ drawing_id: "d1", ops: [{ action: "bogus" }] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level field (.strict())", () => {
    const result = EditDiagramInputSchema.safeParse({
      drawing_id: "d1",
      ops: [{ action: "delete", ids: ["a"] }],
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("applies documented defaults: relayout false, snapshot_first false, render true", () => {
    const result = EditDiagramInputSchema.parse({ drawing_id: "d1", ops: [{ action: "delete", ids: ["a"] }] });
    expect(result.relayout).toBe(false);
    expect(result.snapshot_first).toBe(false);
    expect(result.render).toBe(true);
  });
});

describe("RenderInputSchema", () => {
  it("defaults mode to 'full' and format to 'png'", () => {
    const result = RenderInputSchema.parse({ drawing_id: "d1" });
    expect(result.mode).toBe("full");
    expect(result.format).toBe("png");
    expect(result.scale).toBe(1);
    expect(result.background).toBe("white");
  });

  it("rejects an unknown field", () => {
    expect(RenderInputSchema.safeParse({ drawing_id: "d1", bogus: 1 }).success).toBe(false);
  });

  it("rejects a region missing a required sub-field", () => {
    expect(
      RenderInputSchema.safeParse({ drawing_id: "d1", mode: "region", region: { x: 0, y: 0 } }).success,
    ).toBe(false);
  });
});

describe("other tool schemas — .strict() + defaults smoke test", () => {
  it("ListDrawingsInputSchema defaults scope to 'mine', limit 20, offset 0", () => {
    const result = ListDrawingsInputSchema.parse({});
    expect(result.scope).toBe("mine");
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.response_format).toBe("markdown");
  });

  it("ListDrawingsInputSchema rejects an unknown field", () => {
    expect(ListDrawingsInputSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("GetDrawingInputSchema requires drawing_id and defaults view to 'summary'", () => {
    expect(GetDrawingInputSchema.safeParse({}).success).toBe(false);
    expect(GetDrawingInputSchema.parse({ drawing_id: "d1" }).view).toBe("summary");
  });

  it("ManageDrawingInputSchema requires a known action and rejects unknown fields", () => {
    expect(ManageDrawingInputSchema.safeParse({ drawing_id: "d1", action: "bogus" }).success).toBe(false);
    expect(ManageDrawingInputSchema.safeParse({ drawing_id: "d1", action: "duplicate", bogus: 1 }).success).toBe(false);
    expect(ManageDrawingInputSchema.safeParse({ drawing_id: "d1", action: "duplicate" }).success).toBe(true);
  });

  it("ManageDrawingInputSchema move accepts a null collection_id (uncategorize)", () => {
    const result = ManageDrawingInputSchema.safeParse({ drawing_id: "d1", action: "move", collection_id: null });
    expect(result.success).toBe(true);
  });

  it("CollectionsInputSchema requires a known action", () => {
    expect(CollectionsInputSchema.safeParse({ action: "list" }).success).toBe(true);
    expect(CollectionsInputSchema.safeParse({ action: "bogus" }).success).toBe(false);
  });

  it("GuideInputSchema defaults topic to 'all' and rejects unknown fields", () => {
    expect(GuideInputSchema.parse({}).topic).toBe("all");
    expect(GuideInputSchema.safeParse({ topic: "bogus" }).success).toBe(false);
    expect(GuideInputSchema.safeParse({ topic: "schema", extra: 1 }).success).toBe(false);
  });
});
