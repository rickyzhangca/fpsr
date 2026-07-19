import type { Canvas2DContextLike } from "./canvas2d.js";
import type { ImageSource } from "./host.js";

const TILE_LIGHT = "#1a1a1a";
const TILE_DARK = "#252525";

/** Fill `width`×`height` with an axis-aligned checkerboard; one cell = `pixelsPerTile` px. */
export function drawTileCheckerboard(
  ctx: Canvas2DContextLike,
  width: number,
  height: number,
  pixelsPerTile: number,
  tileOffsetX = 0,
  tileOffsetY = 0,
): void {
  const ppt = Math.max(1, pixelsPerTile);
  const columns = Math.ceil(width / ppt);
  const rows = Math.ceil(height / ppt);
  // Drive coordinates from integer cell indexes. Repeatedly adding a
  // fractional ppt (for example 51.2 after 4K scaling) accumulates enough
  // floating-point error for floor(x / ppt) to repeat a cell at boundaries.
  for (let cellY = 0; cellY < rows; cellY++) {
    const y = cellY * ppt;
    for (let cellX = 0; cellX < columns; cellX++) {
      const x = cellX * ppt;
      ctx.fillStyle =
        (cellX + tileOffsetX + cellY + tileOffsetY) % 2 === 0 ? TILE_DARK : TILE_LIGHT;
      ctx.fillRect(x, y, Math.min(ppt, width - x), Math.min(ppt, height - y));
    }
  }
}

/** Paint an image on top of a tile-aligned checkerboard (for external reference PNGs). */
export function blitWithTileCheckerboard(
  canvas: {
    width: number;
    height: number;
    getContext(type: "2d"): Canvas2DContextLike | null;
  },
  image: ImageSource,
  width: number,
  height: number,
  pixelsPerTile: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  drawTileCheckerboard(ctx, width, height, pixelsPerTile);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, width, height);
}
