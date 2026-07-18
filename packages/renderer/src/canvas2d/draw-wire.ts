import { TRAIN_CHAIN_JOINT_RADIUS } from "../train-chains.js";
import type { TrainChainCmd, WireCmd } from "../types/draw-list.js";
import type { Canvas2DContextLike } from "./types.js";

// FBE-aligned muted wire colors (game uses textured strips; we approximate with
// a thin semi-transparent stroke so they don't read as solid bars).
const WIRE_COLORS: Record<WireCmd["wire"], string> = {
  copper: "#cf7c00",
  red: "#c83718",
  green: "#588c38",
};
/** Stroke width in px at 32 ppt (FBE uses 1.5; we go slightly thinner). */
const WIRE_WIDTH_AT_32PPT = 1;
const WIRE_ALPHA = 0.72;
/** Factorio rolling-stock coupling overlay (procedural; no dedicated sprite).
 * In-game measured color `#658024` (olive). Chart constants like
 * `green_wire_color` / `train_preview_path_outline_color` are pure `#00ff00`
 * and do not match this overlay; `vehicle_wagon_connection_color` is map-only red. */
const TRAIN_CHAIN_COLOR = "#658024";
/** Stroke width in px at 32 ppt (in-game coupling overlay ≈ 3 px). */
const TRAIN_CHAIN_WIDTH_AT_32PPT = 3;
const TRAIN_CHAIN_ALPHA = 0.95;

export function drawWire(
  ctx: Canvas2DContextLike,
  cmd: WireCmd,
  ox: number,
  oy: number,
  ppt: number,
): void {
  const x1 = (cmd.x1 + ox) * ppt;
  const y1 = (cmd.y1 + oy) * ppt;
  const x2 = (cmd.x2 + ox) * ppt;
  const y2 = (cmd.y2 + oy) * ppt;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 + 0.15 * dist;

  const prevAlpha = ctx.globalAlpha;
  ctx.beginPath();
  ctx.strokeStyle = WIRE_COLORS[cmd.wire];
  ctx.lineWidth = (WIRE_WIDTH_AT_32PPT * ppt) / 32;
  ctx.lineCap = "round";
  ctx.globalAlpha = prevAlpha * WIRE_ALPHA;
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.stroke();
  ctx.globalAlpha = prevAlpha;
}

export function drawTrainChain(
  ctx: Canvas2DContextLike,
  cmd: TrainChainCmd,
  ox: number,
  oy: number,
  ppt: number,
): void {
  const prevAlpha = ctx.globalAlpha;
  ctx.strokeStyle = TRAIN_CHAIN_COLOR;
  ctx.lineWidth = (TRAIN_CHAIN_WIDTH_AT_32PPT * ppt) / 32;
  ctx.lineCap = "round";
  ctx.globalAlpha = prevAlpha * TRAIN_CHAIN_ALPHA;

  for (const s of cmd.segments) {
    ctx.beginPath();
    ctx.moveTo((s.x1 + ox) * ppt, (s.y1 + oy) * ppt);
    ctx.lineTo((s.x2 + ox) * ppt, (s.y2 + oy) * ppt);
    ctx.stroke();
  }

  const r = TRAIN_CHAIN_JOINT_RADIUS * ppt;
  for (const j of cmd.joints) {
    ctx.beginPath();
    ctx.arc((j.x + ox) * ppt, (j.y + oy) * ppt, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = prevAlpha;
}
