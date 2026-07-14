import type { Canvas2DContextLike } from "./canvas2d.js";

const TILE_LIGHT = "#1a1a1a";
const TILE_DARK = "#252525";

/** Fill `width`×`height` with an axis-aligned checkerboard; one cell = `pixelsPerTile` px. */
export function drawTileCheckerboard(
  ctx: Canvas2DContextLike,
  width: number,
  height: number,
  pixelsPerTile: number,
): void {
  const ppt = Math.max(1, pixelsPerTile);
  for (let y = 0; y < height; y += ppt) {
    for (let x = 0; x < width; x += ppt) {
      const cellX = Math.floor(x / ppt);
      const cellY = Math.floor(y / ppt);
      ctx.fillStyle = (cellX + cellY) % 2 === 0 ? TILE_DARK : TILE_LIGHT;
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
  image: CanvasImageSource,
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
