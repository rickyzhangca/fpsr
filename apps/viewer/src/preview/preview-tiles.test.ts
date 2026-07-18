import type { RenderMeasurement } from "fpsr";
import { describe, expect, it } from "vite-plus/test";
import {
  selectPreviewPixelsPerTile,
  visiblePreviewTiles,
  type TiledPreviewViewport,
} from "./preview-tiles";

const measurement: RenderMeasurement = {
  tileFrame: { minX: -16, minY: 8, maxX: 48, maxY: 72 },
  requestedPixelsPerTile: 64,
  pixelsPerTile: 64,
  requestedWidth: 4096,
  requestedHeight: 4096,
  width: 4096,
  height: 4096,
  capped: false,
};

const viewport: TiledPreviewViewport = {
  zoom: 1,
  panX: 0,
  panY: 0,
  width: 800,
  height: 600,
};

describe("preview tile geometry", () => {
  it("selects a power-of-two LOD from zoom and display density", () => {
    expect(selectPreviewPixelsPerTile(0.01, 1)).toBe(1);
    expect(selectPreviewPixelsPerTile(0.05, 1)).toBe(4);
    expect(selectPreviewPixelsPerTile(0.2, 1)).toBe(16);
    expect(selectPreviewPixelsPerTile(0.4, 1)).toBe(32);
    expect(selectPreviewPixelsPerTile(0.6, 2)).toBe(64);
    expect(selectPreviewPixelsPerTile(4, 2)).toBe(64);
  });

  it("requests only the visible chunks plus overscan and prioritizes the center", () => {
    const tiles = visiblePreviewTiles(measurement, viewport, 64, 1);
    expect(tiles.map((tile) => tile.key).sort()).toEqual([
      "64:2:2",
      "64:2:3",
      "64:2:4",
      "64:2:5",
      "64:3:2",
      "64:3:3",
      "64:3:4",
      "64:3:5",
      "64:4:2",
      "64:4:3",
      "64:4:4",
      "64:4:5",
      "64:5:2",
      "64:5:3",
      "64:5:4",
      "64:5:5",
    ]);
    expect(tiles[0]).toMatchObject({ column: 3, row: 3 });
    expect(tiles[0]?.tileFrame).toEqual({ minX: 8, minY: 32, maxX: 16, maxY: 40 });
  });

  it("moves the requested tile window when the camera pans", () => {
    const left = visiblePreviewTiles(
      measurement,
      { ...viewport, panX: 1500, width: 400, height: 400 },
      32,
      0,
    );
    expect(new Set(left.map((tile) => tile.column))).toEqual(new Set([0]));
    expect(left.every((tile) => tile.pixelsPerTile === 32)).toBe(true);
  });

  it("covers more world area per tile at distant LODs", () => {
    const hugeMeasurement: RenderMeasurement = {
      ...measurement,
      tileFrame: { minX: -2, minY: -2, maxX: 402, maxY: 302 },
      requestedWidth: 25_856,
      requestedHeight: 19_456,
      width: 25_856,
      height: 19_456,
    };
    const fitted = visiblePreviewTiles(hugeMeasurement, { ...viewport, zoom: 0.015 }, 2, 1);
    expect(fitted).toHaveLength(4);
    expect((fitted[0]?.tileFrame.maxX ?? 0) - (fitted[0]?.tileFrame.minX ?? 0)).toBe(256);

    const close = visiblePreviewTiles(hugeMeasurement, { ...viewport, zoom: 0.26 }, 64, 1);
    expect(close.length).toBeLessThan(100);
    expect(close.every((tile) => tile.tileFrame.maxX - tile.tileFrame.minX <= 8)).toBe(true);
  });
});
