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

describe("CreateDiagramInputSchema — JSON-stringified nested params (agent SDKs sometimes stringify nested tool args)", () => {
  it("accepts spec as a JSON-encoded string, parsing it into the same shape as a real object", () => {
    const stringified = CreateDiagramInputSchema.safeParse({ name: "Flow", spec: JSON.stringify(MINIMAL_SPEC) });
    const real = CreateDiagramInputSchema.safeParse({ name: "Flow", spec: MINIMAL_SPEC });
    expect(stringified.success).toBe(true);
    expect(real.success).toBe(true);
    expect(stringified.success && real.success && stringified.data.spec).toEqual(real.data.spec);
  });

  it("accepts skeleton/elements/files/app_state as JSON-encoded strings", () => {
    const result = CreateDiagramInputSchema.safeParse({
      name: "Flow",
      skeleton: JSON.stringify([{ type: "rectangle" }]),
      files: JSON.stringify({ f1: { mimeType: "image/png" } }),
      app_state: JSON.stringify({ viewBackgroundColor: "#fff" }),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a spec string that is not valid JSON with an actionable message", () => {
    const result = CreateDiagramInputSchema.safeParse({ name: "Flow", spec: "{not valid json" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /spec arrived as a string that is not valid JSON/i.test(issue.message))).toBe(true);
    }
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

  it("accepts region/element_ids as JSON-encoded strings", () => {
    const result = RenderInputSchema.safeParse({
      drawing_id: "d1",
      mode: "region",
      region: JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }),
      element_ids: JSON.stringify(["a", "b"]),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toEqual({ x: 0, y: 0, width: 100, height: 100 });
      expect(result.data.element_ids).toEqual(["a", "b"]);
    }
  });

  it("rejects a region string that is not valid JSON with an actionable message", () => {
    const result = RenderInputSchema.safeParse({ drawing_id: "d1", mode: "region", region: "not json" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /region arrived as a string that is not valid JSON/i.test(issue.message))).toBe(true);
    }
  });
});

describe("EditDiagramInputSchema — JSON-stringified nested params", () => {
  it("accepts the whole ops array as a JSON-encoded string", () => {
    const ops = [{ action: "delete", ids: ["a"] }];
    const result = EditDiagramInputSchema.safeParse({ drawing_id: "d1", ops: JSON.stringify(ops) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ops).toEqual(ops);
  });

  it("accepts a real ops array whose 'add' op has a stringified spec and a stringified 'update' op patch", () => {
    const result = EditDiagramInputSchema.safeParse({
      drawing_id: "d1",
      ops: [
        { action: "add", spec: JSON.stringify(MINIMAL_SPEC) },
        { action: "update", id: "a", patch: JSON.stringify({ backgroundColor: "#fff" }) },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ops[0]).toMatchObject({ action: "add", spec: MINIMAL_SPEC });
      expect(result.data.ops[1]).toMatchObject({ action: "update", patch: { backgroundColor: "#fff" } });
    }
  });

  it("accepts a stringified 'delete' ids array and a stringified 'replace_all' elements array within a real ops array", () => {
    const result = EditDiagramInputSchema.safeParse({
      drawing_id: "d1",
      ops: [{ action: "delete", ids: JSON.stringify(["a", "b"]) }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ops[0]).toMatchObject({ action: "delete", ids: ["a", "b"] });
  });

  it("rejects an ops string that is not valid JSON with an actionable message", () => {
    const result = EditDiagramInputSchema.safeParse({ drawing_id: "d1", ops: "not json" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /ops arrived as a string that is not valid JSON/i.test(issue.message))).toBe(true);
    }
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
