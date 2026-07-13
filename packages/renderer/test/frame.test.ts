import { describe, expect, it } from "vite-plus/test";
import { computeTileFrame } from "../src/frame.js";
import type { DrawListBounds } from "../src/types/draw-list.js";

/** Collision-ish footprint of the 2x2 belt pinwheel (see pinwheelEntities in renderer tests). */
const pinwheelBounds: DrawListBounds = {
  minX: -440.9,
  minY: -37.9,
  maxX: -439.1,
  maxY: -36.1,
};

/** Single small-electric-pole object sprite extent at (0.5, 0.5). */
const tallPoleBounds: DrawListBounds = {
  minX: -0.0156,
  minY: -2.5468,
  maxX: 1.1094,
  maxY: 0.9,
};

describe("computeTileFrame", () => {
  it("frames a 2x2 belt pinwheel as 4x4 tiles with padTiles=1", () => {
    const frame = computeTileFrame(pinwheelBounds, 1);
    expect(frame).toEqual({ minX: -442, minY: -39, maxX: -438, maxY: -35 });
    expect(frame.maxX - frame.minX).toBe(4);
    expect(frame.maxY - frame.minY).toBe(4);
  });

  it("includes tall pole sprite height with default padTiles=0", () => {
    const frame = computeTileFrame(tallPoleBounds, 0);
    expect(frame.minY).toBe(-3);
    expect(frame.maxY).toBe(1);
    expect(frame.minX).toBe(-1);
    expect(frame.maxX).toBe(2);
  });

  it("adds optional padTiles margin on each side", () => {
    const frame = computeTileFrame(tallPoleBounds, 1);
    expect(frame.minY).toBe(-4);
    expect(frame.maxY).toBe(2);
  });

  it("includes floor tiles in the frame", () => {
    const bounds: DrawListBounds = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
    const frame = computeTileFrame(bounds, 1);
    expect(frame.minX).toBe(-1);
    expect(frame.maxX - frame.minX).toBe(4);
    expect(frame.maxY - frame.minY).toBe(3);
  });

  it("handles empty bounds with padTiles", () => {
    const frame = computeTileFrame({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 1);
    expect(frame).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
  });
});
