import type { Canvas2DContextLike } from "./canvas2d.js";
import type { TileFrame } from "./frame.js";

const GRID_STROKE = "rgba(255, 255, 255, 0.28)";
const LABEL_FILL = "rgba(255, 255, 255, 0.85)";
const LABEL_SHADOW = "rgba(0, 0, 0, 0.75)";

/** How often to place a cell label based on pixels-per-tile. */
function labelStride(pixelsPerTile: number): number {
  if (pixelsPerTile < 12) return 4;
  if (pixelsPerTile < 24) return 2;
  return 1;
}

/**
 * Draw map-space tile grid lines and coordinate labels over a rendered preview.
 * Canvas (0,0) corresponds to `tileFrame.minX/minY`.
 */
export function drawCoordinateOverlay(
  ctx: Canvas2DContextLike,
  tileFrame: TileFrame,
  pixelsPerTile: number,
  width: number,
  height: number,
  outputTileFrame: TileFrame = tileFrame,
): void {
  const { minX, minY, maxX, maxY } = tileFrame;
  const cols = maxX - minX;
  const rows = maxY - minY;
  if (cols <= 0 || rows <= 0 || pixelsPerTile <= 0) return;

  ctx.save();
  ctx.strokeStyle = GRID_STROKE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= cols; i++) {
    const x = i * pixelsPerTile + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let j = 0; j <= rows; j++) {
    const y = j * pixelsPerTile + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  const stride = labelStride(pixelsPerTile);
  const fontSize = Math.max(8, Math.min(12, Math.floor(pixelsPerTile * 0.35)));
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const pad = Math.max(1, Math.floor(pixelsPerTile * 0.06));
  const columnStart = (((outputTileFrame.minX - minX) % stride) + stride) % stride;
  const rowStart = (((outputTileFrame.minY - minY) % stride) + stride) % stride;

  for (let j = rowStart; j < rows; j += stride) {
    for (let i = columnStart; i < cols; i += stride) {
      const tx = minX + i;
      const ty = minY + j;
      const label = `${tx},${ty}`;
      const x = i * pixelsPerTile + pad;
      const y = j * pixelsPerTile + pad;
      ctx.fillStyle = LABEL_SHADOW;
      ctx.fillText(label, x + 1, y + 1);
      ctx.fillStyle = LABEL_FILL;
      ctx.fillText(label, x, y);
    }
  }

  ctx.restore();
}
