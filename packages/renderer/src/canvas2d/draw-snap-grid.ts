import type { SnapGridCmd } from "../types/draw-list.js";
import type { Canvas2DContextLike } from "./types.js";

/** Factorio snap-rectangle green. */
const SNAP_GRID_STROKE = "#3cff00";
const SNAP_GRID_STROKE_OUTER = "#0a3d00";
/** Dash pattern in tiles at 32 ppt. */
const SNAP_DASH_AT_32PPT = [10, 6];

/**
 * Draw the blueprint snap-to-grid rectangle as a dashed perimeter along the
 * four edges (no corner L-brackets).
 */
export function drawSnapGrid(
  ctx: Canvas2DContextLike,
  cmd: SnapGridCmd,
  ox: number,
  oy: number,
  ppt: number,
): void {
  const { x, y, w, h } = cmd;
  if (!(w > 0) || !(h > 0)) return;
  drawSnapGridStroke(ctx, x, y, w, h, ox, oy, ppt);
}

function drawSnapGridStroke(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  w: number,
  h: number,
  ox: number,
  oy: number,
  ppt: number,
): void {
  const px = (x + ox) * ppt;
  const py = (y + oy) * ppt;
  const pw = w * ppt;
  const ph = h * ppt;
  const lineWidth = Math.max(2, (3 * ppt) / 32);
  const dash = SNAP_DASH_AT_32PPT.map((v) => (v * ppt) / 32);

  ctx.save();
  if (typeof ctx.setLineDash === "function") ctx.setLineDash(dash);
  ctx.lineCap = "butt";
  ctx.lineWidth = lineWidth + 2;
  ctx.strokeStyle = SNAP_GRID_STROKE_OUTER;
  strokeRectCompat(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = SNAP_GRID_STROKE;
  strokeRectCompat(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1);
  if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
  ctx.restore();
}

function strokeRectCompat(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (typeof ctx.strokeRect === "function") {
    ctx.strokeRect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
}
