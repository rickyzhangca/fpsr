import { describe, expect, it } from "vite-plus/test";
import { frameRect, resolveSpriteFile, spriteFrameCount } from "../src/sprite.js";
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

  it("packs single-frame rotated directions in a line_length grid", () => {
    const sheet: RawSprite = {
      filename: "turret.png",
      width: 10,
      height: 20,
      frame_count: 1,
      direction_count: 64,
      line_length: 8,
    };
    expect(frameRect(sheet, 0, 19)).toEqual({ x: 30, y: 40, w: 10, h: 20 });
  });

  it("resolves rotated-animation stripes containing every animation frame", () => {
    const sheet: RawSprite = {
      width: 10,
      height: 20,
      frame_count: 2,
      direction_count: 3,
      stripes: [
        { filename: "a.png", width_in_frames: 2, height_in_frames: 2 },
        { filename: "b.png", width_in_frames: 2, height_in_frames: 1 },
      ],
    };
    expect(resolveSpriteFile(sheet, 1, 2)).toMatchObject({
      sprite: { filename: "b.png", frame_count: 2, direction_count: 1 },
      frame: 1,
      dir: 0,
    });
  });

  it("resolves repeated one-column stripes used by car masks and shadows", () => {
    const sheet: RawSprite = {
      width: 10,
      height: 20,
      frame_count: 2,
      direction_count: 3,
      stripes: [
        { filename: "a.png", width_in_frames: 1, height_in_frames: 2 },
        { filename: "a.png", width_in_frames: 1, height_in_frames: 2 },
        { filename: "b.png", width_in_frames: 1, height_in_frames: 1 },
        { filename: "b.png", width_in_frames: 1, height_in_frames: 1 },
      ],
    };
    expect(resolveSpriteFile(sheet, 1, 0)).toMatchObject({
      sprite: { filename: "a.png", frame_count: 1, direction_count: 2 },
      frame: 0,
      dir: 0,
    });
    expect(resolveSpriteFile(sheet, 0, 2)).toMatchObject({
      sprite: { filename: "b.png", frame_count: 1, direction_count: 1 },
      frame: 0,
      dir: 0,
    });
  });
});
