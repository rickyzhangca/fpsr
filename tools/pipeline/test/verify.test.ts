import { describe, expect, it } from "vite-plus/test";
import { assertTierStorageCeiling } from "../src/verify.js";

describe("assertTierStorageCeiling", () => {
  it("accepts a tiered bundle at the 125% storage boundary", () => {
    expect(() =>
      assertTierStorageCeiling({ "1x": { bytes: 25 }, "2x": { bytes: 100 } }),
    ).not.toThrow();
  });

  it("rejects a tiered bundle above the 2x-only storage budget", () => {
    expect(() => assertTierStorageCeiling({ "1x": { bytes: 26 }, "2x": { bytes: 100 } })).toThrow(
      /exceeds 125% of the 2x-only/,
    );
  });
});
