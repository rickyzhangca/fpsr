import { describe, expect, it } from "vite-plus/test";
import { trimRgba } from "../src/sprite.js";

describe("trimRgba", () => {
  it("accepts Factorio's 1x1 transparent connector placeholders", async () => {
    const result = await trimRgba(Buffer.from([0, 0, 0, 0]), 1, 1);
    expect(result).toEqual({ rgba: Buffer.alloc(0), tw: 0, th: 0, ox: 0, oy: 0 });
  });

  it("keeps a 1x1 opaque sprite", async () => {
    const pixel = Buffer.from([12, 34, 56, 255]);
    const result = await trimRgba(pixel, 1, 1);
    expect(result).toEqual({ rgba: pixel, tw: 1, th: 1, ox: 0, oy: 0 });
  });
});
