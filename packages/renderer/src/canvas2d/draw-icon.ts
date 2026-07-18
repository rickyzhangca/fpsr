import { entityInfoSilhouettePadPx } from "../icon-silhouette.js";
import type { IconCmd } from "../types/draw-list.js";
import type { FrameMeta } from "../types/render-db.js";
import type { Canvas2DContextLike } from "./types.js";
import { packedHeight, packedWidth } from "./util.js";

// Entity-info icons occupy 32 px at scale 1. The backing is a 53 px
// `extra-high-no-scale` utility sprite, so it intentionally extends beyond
// the foreground icon instead of being normalized as another 64 px icon.
const ENTITY_INFO_BASE_ICON_PX = 32;
/** Scale the foreground icon inside the pin so it sits above the chevron. */
const REQUEST_PIN_ICON_SCALE = 0.7;
/** Shift the pin icon upward (fraction of command size) into the pin body. */
const REQUEST_PIN_ICON_Y_SHIFT = 0.1;
/**
 * Trimmed atlas width still includes soft alpha fringe. Opaque chrome (a>20) is
 * ~44 px of the 48 px trim — scale to that so layout gaps match the visible edge.
 */
const REQUEST_PIN_OPAQUE_WIDTH_RATIO = 44 / 48;

export function drawIcon(
  ctx: Canvas2DContextLike,
  cmd: IconCmd,
  frame: FrameMeta,
  image: CanvasImageSource,
  frames: FrameMeta[],
  images: CanvasImageSource[],
  iconImage: CanvasImageSource | undefined,
  silhouetteImage: CanvasImageSource | undefined,
  ox: number,
  oy: number,
  ppt: number,
): void {
  const size = cmd.size * ppt;
  const cx = (cmd.x + ox) * ppt;
  const cy = (cmd.y + oy) * ppt;
  const isRequestPin = cmd.backingStyle === "request-pin";
  const left = cx - size / 2;
  const top = cy - size / 2;

  const backingFrame = cmd.backingFrame == null ? undefined : frames[cmd.backingFrame];
  const backingImage = backingFrame ? images[backingFrame.a] : undefined;
  if (backingFrame && backingImage) {
    // Request pins: map opaque chrome width to cmd.size (trim still has soft fringe).
    // Entity-info: 53px around 32px.
    const backingBasePx = isRequestPin
      ? Math.max(1, backingFrame.w * REQUEST_PIN_OPAQUE_WIDTH_RATIO)
      : ENTITY_INFO_BASE_ICON_PX;
    const backingScale = size / backingBasePx;
    const backingWidth = backingFrame.sw * backingScale;
    const backingHeight = backingFrame.sh * backingScale;
    const backingLeft = cx - backingWidth / 2;
    const backingTop = cy - backingHeight / 2;
    const previousAlpha = ctx.globalAlpha;
    // Entity-info: soft disc at 16% alpha; request-pin: full-alpha cyan chrome.
    if (!isRequestPin) ctx.globalAlpha = previousAlpha * 0.16;
    ctx.drawImage(
      backingImage,
      backingFrame.x,
      backingFrame.y,
      packedWidth(backingFrame),
      packedHeight(backingFrame),
      backingLeft + backingFrame.ox * backingScale,
      backingTop + backingFrame.oy * backingScale,
      backingFrame.w * backingScale,
      backingFrame.h * backingScale,
    );
    ctx.globalAlpha = previousAlpha;
  } else if (cmd.backing) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const radius = size * 0.15;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(left, top, size, size, radius);
      ctx.fill();
    } else {
      ctx.fillRect(left, top, size, size);
    }
  }

  const drawSize = isRequestPin ? size * REQUEST_PIN_ICON_SCALE : size;
  const drawCx = cx;
  const drawCy = isRequestPin ? cy - size * REQUEST_PIN_ICON_Y_SHIFT : cy;
  const drawLeft = drawCx - drawSize / 2;
  const drawTop = drawCy - drawSize / 2;
  const iconScaleX = frame.sw === 0 ? 0 : drawSize / frame.sw;
  const iconScaleY = frame.sh === 0 ? 0 : drawSize / frame.sh;
  const iconLeft = drawLeft + frame.ox * iconScaleX;
  const iconTop = drawTop + frame.oy * iconScaleY;
  const iconWidth = frame.w * iconScaleX;
  const iconHeight = frame.h * iconScaleY;
  const hasEntityInfoBacking = !isRequestPin && (backingFrame != null || cmd.backing === true);
  const needsEntityInfoSilhouette =
    !isRequestPin && (hasEntityInfoBacking || cmd.silhouette === true);
  const drawIconLayer = (
    sourceImage: CanvasImageSource,
    sourceX: number,
    sourceY: number,
    sourceW: number,
    sourceH: number,
    destLeft: number,
    destTop: number,
    destWidth: number,
    destHeight: number,
  ): void => {
    if (cmd.rotation != null && cmd.rotation !== 0) {
      ctx.save();
      ctx.translate(drawCx, drawCy);
      ctx.rotate((cmd.rotation * Math.PI) / 180);
      ctx.drawImage(
        sourceImage,
        sourceX,
        sourceY,
        sourceW,
        sourceH,
        destLeft - drawCx,
        destTop - drawCy,
        destWidth,
        destHeight,
      );
      ctx.restore();
      return;
    }
    ctx.drawImage(
      sourceImage,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      destLeft,
      destTop,
      destWidth,
      destHeight,
    );
  };

  if (needsEntityInfoSilhouette && iconImage && silhouetteImage) {
    const pad = entityInfoSilhouettePadPx();
    const sourcePad = Math.max(1, Math.round(pad * (packedWidth(frame) / frame.w)));
    const padX = pad * iconScaleX;
    const padY = pad * iconScaleY;
    drawIconLayer(
      silhouetteImage,
      0,
      0,
      packedWidth(frame) + 2 * sourcePad,
      packedHeight(frame) + 2 * sourcePad,
      iconLeft - padX,
      iconTop - padY,
      iconWidth + 2 * padX,
      iconHeight + 2 * padY,
    );
    drawIconLayer(
      iconImage,
      0,
      0,
      packedWidth(frame),
      packedHeight(frame),
      iconLeft,
      iconTop,
      iconWidth,
      iconHeight,
    );
    return;
  }

  const sourceImage = iconImage ?? image;
  const sourceX = iconImage ? 0 : frame.x;
  const sourceY = iconImage ? 0 : frame.y;
  drawIconLayer(
    sourceImage,
    sourceX,
    sourceY,
    packedWidth(frame),
    packedHeight(frame),
    iconLeft,
    iconTop,
    iconWidth,
    iconHeight,
  );
}
