import { describe, expect, it } from "vitest";
import {
  calculateExpiresAt,
  deriveExpiryStateFromLink,
  toDatetimeLocalValue,
} from "./ShareModal";

describe("calculateExpiresAt", () => {
  it("returns null (not undefined) for 'never'", () => {
    expect(calculateExpiresAt("never")).toBeNull();
  });

  it("returns an ISO string for a preset option", () => {
    const result = calculateExpiresAt("1d");
    expect(typeof result).toBe("string");
    expect(Number.isFinite(new Date(result as string).getTime())).toBe(true);
  });

  it("returns undefined for an unknown option", () => {
    expect(calculateExpiresAt("bogus")).toBeUndefined();
  });

  it("converts a custom datetime-local value to an ISO string", () => {
    const result = calculateExpiresAt("custom", "2030-01-02T03:04");
    expect(typeof result).toBe("string");
    expect(new Date(result as string).getFullYear()).toBe(2030);
  });

  it("returns undefined for an empty custom value", () => {
    expect(calculateExpiresAt("custom", "")).toBeUndefined();
  });

  it("returns undefined for a past custom value", () => {
    expect(calculateExpiresAt("custom", "2000-01-02T03:04")).toBeUndefined();
  });
});

describe("deriveExpiryStateFromLink", () => {
  it("maps null expiry to the 'never' option", () => {
    expect(deriveExpiryStateFromLink(null)).toEqual({
      expiryOption: "never",
      customExpiry: "",
    });
  });

  it("maps a date expiry to the 'custom' option with a prefilled picker value", () => {
    const iso = new Date("2030-06-01T12:30:00").toISOString();
    const state = deriveExpiryStateFromLink(iso);
    expect(state.expiryOption).toBe("custom");
    expect(state.customExpiry).toBe(toDatetimeLocalValue(iso));
    expect(state.customExpiry).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
