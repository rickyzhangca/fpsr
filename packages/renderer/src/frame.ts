import type { DrawListBounds } from "./types/draw-list.js";

/** Integer tile-space viewport used for canvas sizing and pan (maps minX/minY to pixel 0). */
export interface TileFrame {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Tile-aligned viewport from draw-list visual bounds, optionally plus `padTiles`
 * on each side. Visual bounds already include sprite overhang, shadows, and wires;
 * `padTiles` defaults to 0 in the renderer. All edges are integers so the canvas is
 * an exact multiple of `pixelsPerTile` with no fragmented checker cells.
 */
export function computeTileFrame(bounds: DrawListBounds, padTiles: number): TileFrame {
  return {
    minX: Math.floor(bounds.minX) - padTiles,
    minY: Math.floor(bounds.minY) - padTiles,
    maxX: Math.ceil(bounds.maxX) + padTiles,
    maxY: Math.ceil(bounds.maxY) + padTiles,
  };
}
