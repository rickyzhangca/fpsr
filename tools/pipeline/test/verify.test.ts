import { describe, expect, it } from "vite-plus/test";
import { assertTierStorageCeiling } from "../src/verify.js";

describe("assertTierStorageCeiling", () => {
  it("accepts a tiered bundle at the 140% storage boundary", () => {
    expect(() =>
      assertTierStorageCeiling({ "1x": { bytes: 40 }, "2x": { bytes: 100 } }),
    ).not.toThrow();
  });

  it("rejects a tiered bundle above the 2x-only storage budget", () => {
    expect(() => assertTierStorageCeiling({ "1x": { bytes: 41 }, "2x": { bytes: 100 } })).toThrow(
      /exceeds 140% of the 2x-only/,
    );
  });
});
