import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonTolerant } from "./common.js";

describe("jsonTolerant", () => {
  const Wrapped = jsonTolerant(z.object({ a: z.number() }).strict(), "thing");

  it("passes a real object through untouched (the common, SDK-driven-client case)", () => {
    const result = Wrapped.safeParse({ a: 1 });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ a: 1 });
  });

  it("parses a JSON-encoded string into the object it represents", () => {
    const result = Wrapped.safeParse(JSON.stringify({ a: 1 }));
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ a: 1 });
  });

  it("still applies the inner schema's own validation after parsing a stringified value", () => {
    const result = Wrapped.safeParse(JSON.stringify({ a: "not a number" }));
    expect(result.success).toBe(false);
  });

  it("fails with an actionable message when the string is not valid JSON at all", () => {
    const result = Wrapped.safeParse("{not json");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/thing arrived as a string that is not valid JSON/i);
      expect(result.error.issues[0]?.message).toMatch(/pass a JSON object/i);
    }
  });

  it("names an array-shaped field as a JSON array, not a JSON object, in the actionable message", () => {
    const WrappedArray = jsonTolerant(z.array(z.string()).min(1), "ids", "array");
    const result = WrappedArray.safeParse("not json");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/pass a JSON array/i);
    }
  });

  it("leaves non-string, non-JSON-ish values (e.g. numbers) to the inner schema's own type error", () => {
    const result = Wrapped.safeParse(42);
    expect(result.success).toBe(false);
  });
});
