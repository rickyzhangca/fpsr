import type { RectCmd, SpriteCmd } from "../types/draw-list.js";
import type { FrameMeta } from "../types/render-db.js";
import type { Canvas2DContextLike, ExecuteDrawListOptions } from "./types.js";
import { packedHeight, packedWidth, rgba } from "./util.js";

export function drawRect(
  ctx: Canvas2DContextLike,
  cmd: RectCmd,
  ox: number,
  oy: number,
  ppt: number,
): void {
  ctx.fillStyle = rgba(cmd.color);
  ctx.fillRect((cmd.x + ox) * ppt, (cmd.y + oy) * ppt, cmd.w * ppt, cmd.h * ppt);
}

export function atlasSourceRect(
  frame: FrameMeta,
  src: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const packedW = packedWidth(frame);
  const packedH = packedHeight(frame);
  const atlasScaleX = frame.w === 0 ? 0 : packedW / frame.w;
  const atlasScaleY = frame.h === 0 ? 0 : packedH / frame.h;
  const relX = src.x - frame.ox;
  const relY = src.y - frame.oy;
  return {
    x: frame.x + relX * atlasScaleX,
    y: frame.y + relY * atlasScaleY,
    w: src.w * atlasScaleX,
    h: src.h * atlasScaleY,
  };
}

export function drawSprite(
  ctx: Canvas2DContextLike,
  cmd: SpriteCmd,
  frame: FrameMeta,
  image: CanvasImageSource,
  ox: number,
  oy: number,
  ppt: number,
  createCanvas?: ExecuteDrawListOptions["createCanvas"],
): void {
  const dx = (cmd.x + ox) * ppt;
  const dy = (cmd.y + oy) * ppt;
  const dw = cmd.w * ppt;
  const dh = cmd.h * ppt;

  const src = cmd.src ?? { x: 0, y: 0, w: frame.sw, h: frame.sh };
  const scaleX = src.w === 0 ? 0 : dw / src.w;
  const scaleY = src.h === 0 ? 0 : dh / src.h;
  const atlasSrc = cmd.src
    ? atlasSourceRect(frame, src)
    : {
        x: frame.x,
        y: frame.y,
        w: packedWidth(frame),
        h: packedHeight(frame),
      };
  const trimmedDx = cmd.src ? dx : dx + frame.ox * scaleX;
  const trimmedDy = cmd.src ? dy : dy + frame.oy * scaleY;
  const trimmedDw = cmd.src ? dw : frame.w * scaleX;
  const trimmedDh = cmd.src ? dh : frame.h * scaleY;

  const prevAlpha = ctx.globalAlpha;
  if (cmd.shadow) {
    ctx.globalAlpha = prevAlpha * 0.5;
  }

  const flipX = cmd.flipX === true;
  const flipY = cmd.flipY === true;
  const rotation = cmd.rotation ?? 0;
  const hasClip = cmd.clip != null;
  const tint = cmd.tint;

  const blit = (
    target: Canvas2DContextLike,
    destDx: number,
    destDy: number,
    destDw: number,
    destDh: number,
  ): void => {
    target.drawImage(
      image,
      atlasSrc.x,
      atlasSrc.y,
      atlasSrc.w,
      atlasSrc.h,
      destDx,
      destDy,
      destDw,
      destDh,
    );
  };

  /** Multiply-tint the sprite via an offscreen canvas, then draw the result. */
  const tintedSource = (): { image: CanvasImageSource; w: number; h: number } | null => {
    if (!tint || !createCanvas) return null;
    const tw = Math.max(1, Math.ceil(trimmedDw));
    const th = Math.max(1, Math.ceil(trimmedDh));
    const scratch = createCanvas(tw, th);
    scratch.width = tw;
    scratch.height = th;
    const sctx = scratch.getContext("2d");
    if (!sctx) return null;
    sctx.imageSmoothingEnabled = false;
    blit(sctx, 0, 0, tw, th);
    sctx.globalCompositeOperation = "multiply";
    sctx.fillStyle = rgba(tint);
    sctx.fillRect(0, 0, tw, th);
    sctx.globalCompositeOperation = "destination-in";
    blit(sctx, 0, 0, tw, th);
    sctx.globalCompositeOperation = "source-over";
    return { image: scratch as unknown as CanvasImageSource, w: tw, h: th };
  };

  const tinted = tintedSource();

  if (hasClip) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      (cmd.clip!.x + ox) * ppt,
      (cmd.clip!.y + oy) * ppt,
      cmd.clip!.w * ppt,
      cmd.clip!.h * ppt,
    );
    ctx.clip();
  }

  if (flipX || flipY || rotation !== 0) {
    // Rotate/flip around the untrimmed sprite center so shift+rotation stay aligned.
    const ucx = dx + dw / 2;
    const ucy = dy + dh / 2;
    ctx.save();
    ctx.translate(ucx, ucy);
    if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    if (tinted) {
      ctx.drawImage(
        tinted.image,
        0,
        0,
        tinted.w,
        tinted.h,
        trimmedDx - ucx,
        trimmedDy - ucy,
        trimmedDw,
        trimmedDh,
      );
    } else {
      blit(ctx, trimmedDx - ucx, trimmedDy - ucy, trimmedDw, trimmedDh);
    }
    ctx.restore();
  } else if (tinted) {
    ctx.drawImage(
      tinted.image,
      0,
      0,
      tinted.w,
      tinted.h,
      trimmedDx,
      trimmedDy,
      trimmedDw,
      trimmedDh,
    );
  } else {
    blit(ctx, trimmedDx, trimmedDy, trimmedDw, trimmedDh);
  }

  if (hasClip) {
    ctx.restore();
  }

  if (cmd.shadow) {
    ctx.globalAlpha = prevAlpha;
  }
}

interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function shadowSpriteBounds(
  cmd: SpriteCmd,
  frame: FrameMeta,
  ox: number,
  oy: number,
  ppt: number,
  outputWidth: number,
  outputHeight: number,
): PixelBounds | null {
  const dx = (cmd.x + ox) * ppt;
  const dy = (cmd.y + oy) * ppt;
  const dw = cmd.w * ppt;
  const dh = cmd.h * ppt;
  const scaleX = frame.sw === 0 ? 0 : dw / frame.sw;
  const scaleY = frame.sh === 0 ? 0 : dh / frame.sh;
  const left = dx + frame.ox * scaleX;
  const top = dy + frame.oy * scaleY;
  const right = left + frame.w * scaleX;
  const bottom = top + frame.h * scaleY;
  const centerX = dx + dw / 2;
  const centerY = dy + dh / 2;
  const radians = ((cmd.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const flipX = cmd.flipX === true ? -1 : 1;
  const flipY = cmd.flipY === true ? -1 : 1;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ] as const) {
    const localX = (x - centerX) * flipX;
    const localY = (y - centerY) * flipY;
    const transformedX = centerX + localX * cos - localY * sin;
    const transformedY = centerY + localX * sin + localY * cos;
    minX = Math.min(minX, transformedX);
    minY = Math.min(minY, transformedY);
    maxX = Math.max(maxX, transformedX);
    maxY = Math.max(maxY, transformedY);
  }

  // Preserve transformed edge pixels at tile boundaries. The gutter is only
  // used for conservative command-to-tile assignment; the tile canvas itself
  // provides the exact output clip.
  minX = Math.floor(minX) - 1;
  minY = Math.floor(minY) - 1;
  maxX = Math.ceil(maxX) + 1;
  maxY = Math.ceil(maxY) + 1;

  if (cmd.clip) {
    const clipLeft = (cmd.clip.x + ox) * ppt;
    const clipTop = (cmd.clip.y + oy) * ppt;
    const clipRight = clipLeft + cmd.clip.w * ppt;
    const clipBottom = clipTop + cmd.clip.h * ppt;
    minX = Math.max(minX, clipLeft);
    minY = Math.max(minY, clipTop);
    maxX = Math.min(maxX, clipRight);
    maxY = Math.min(maxY, clipBottom);
  }

  minX = Math.max(0, minX);
  minY = Math.max(0, minY);
  maxX = Math.min(outputWidth, maxX);
  maxY = Math.min(outputHeight, maxY);
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}
