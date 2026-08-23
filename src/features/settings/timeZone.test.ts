import { describe, expect, it } from "vite-plus/test";
import { normalizeTimeZone } from "./timeZone";

describe("normalizeTimeZone", () => {
  it("accepts and canonicalizes supported time zones", () => {
    expect(normalizeTimeZone(" UTC ")).toBe("UTC");
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("rejects missing and unsupported time zones", () => {
    expect(normalizeTimeZone("")).toBeNull();
    expect(normalizeTimeZone("Not/A_Time_Zone")).toBeNull();
    expect(normalizeTimeZone(null)).toBeNull();
  });
});
