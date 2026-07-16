import { describe, expect, it } from "vite-plus/test";
import type { Canvas2DContextLike } from "../src/canvas2d.js";
import { drawTileCheckerboard } from "../src/checkerboard.js";

describe("drawTileCheckerboard", () => {
  it("alternates continuously past row and column 32 with fractional pixels per tile", () => {
    const fills: Array<{ color: string; x: number; y: number }> = [];
    let fillStyle = "";
    const context = {
      set fillStyle(value: string) {
        fillStyle = value;
      },
      fillRect(x: number, y: number) {
        fills.push({ color: fillStyle, x, y });
      },
    } as unknown as Canvas2DContextLike;
    const pixelsPerTile = 51.2;

    drawTileCheckerboard(context, pixelsPerTile * 35, pixelsPerTile * 35, pixelsPerTile);

    expect(fills).toHaveLength(35 * 35);
    const row = fills.filter((fill) => fill.y === 0);
    const column = fills.filter((fill) => fill.x === 0);
    for (const line of [row, column]) {
      expect(line).toHaveLength(35);
      for (let index = 1; index < line.length; index++) {
        expect(line[index]?.color).not.toBe(line[index - 1]?.color);
      }
      expect(line[31]?.color).not.toBe(line[32]?.color);
      expect(line[32]?.color).not.toBe(line[33]?.color);
    }
  });
});
