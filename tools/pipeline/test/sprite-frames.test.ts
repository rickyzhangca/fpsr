import { describe, expect, it } from "vite-plus/test";
import { frameRect, spriteFrameCount } from "../src/sprite.js";
import type { RawSprite } from "../src/types.js";

describe("spriteFrameCount / SpriteNWaySheet frames", () => {
  it("uses frames when frame_count is absent (storage-tank sheets)", () => {
    const sheet: RawSprite = {
      filename: "__base__/graphics/entity/storage-tank/storage-tank.png",
      frames: 2,
      width: 219,
      height: 235,
    };
    expect(spriteFrameCount(sheet)).toBe(2);
    expect(frameRect(sheet, 0, 0, { width: 438, height: 235 })).toEqual({
      x: 0,
      y: 0,
      w: 219,
      h: 235,
    });
    expect(frameRect(sheet, 1, 0, { width: 438, height: 235 })).toEqual({
      x: 219,
      y: 0,
      w: 219,
      h: 235,
    });
  });

  it("prefers frame_count over frames", () => {
    const sheet: RawSprite = {
      filename: "x.png",
      frames: 2,
      frame_count: 4,
      width: 10,
      height: 10,
    };
    expect(spriteFrameCount(sheet)).toBe(4);
  });
});
