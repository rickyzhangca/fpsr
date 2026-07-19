import { fpsrTextFontCss } from "../text-font.js";
import type { TextCmd } from "../types/draw-list.js";
import type { Canvas2DContextLike } from "./types.js";
import { rgba } from "./util.js";

export function drawText(
  ctx: Canvas2DContextLike,
  cmd: TextCmd,
  ox: number,
  oy: number,
  ppt: number,
): void {
  const sizePx = Math.max(1, cmd.size * ppt);
  ctx.save();
  ctx.font = fpsrTextFontCss(sizePx);
  ctx.textAlign = cmd.align ?? "left";
  ctx.textBaseline = cmd.baseline ?? "top";
  ctx.fillStyle = rgba(cmd.color);
  ctx.fillText(cmd.text, (cmd.x + ox) * ppt, (cmd.y + oy) * ppt);
  ctx.restore();
}
