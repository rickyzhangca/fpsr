import { drawTileCheckerboard } from "./checkerboard.js";
import { drawCoordinateOverlay } from "./coordinate-overlay.js";
import { entityInfoSilhouettePadPx } from "./icon-silhouette.js";
import { TRAIN_CHAIN_JOINT_RADIUS } from "./train-chains.js";
import type {
  DrawList,
  IconCmd,
  RectCmd,
  SpriteCmd,
  TrainChainCmd,
  WireCmd,
} from "./types/draw-list.js";
import type { FrameMeta } from "./types/render-db.js";

function packedWidth(frame: FrameMeta): number {
  return frame.pw ?? frame.w;
}

function packedHeight(frame: FrameMeta): number {
  return frame.ph ?? frame.h;
}

/** Minimal Canvas 2D surface used by the backend (browser or skia-canvas). */
export interface Canvas2DContextLike {
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  translate(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(): void;
  roundRect?(x: number, y: number, w: number, h: number, radii: number | number[]): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillText(text: string, x: number, y: number): void;
  set fillStyle(value: string | CanvasGradient | CanvasPattern);
  set strokeStyle(value: string | CanvasGradient | CanvasPattern);
  set lineWidth(value: number);
  set lineCap(value: CanvasLineCap);
  set globalAlpha(value: number);
  get globalAlpha(): number;
  set globalCompositeOperation(value: GlobalCompositeOperation);
  get globalCompositeOperation(): GlobalCompositeOperation;
  set filter(value: string);
  set font(value: string);
  set textBaseline(value: CanvasTextBaseline);
  set textAlign(value: CanvasTextAlign);
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality?: "low" | "medium" | "high";
}

export interface ExecuteDrawListOptions {
  pixelsPerTile: number;
  padTiles?: number;
  /** Integer tile viewport; when set, canvas origin aligns to tile grid. */
  tileFrame?: { minX: number; minY: number; maxX: number; maxY: number };
  background?: [number, number, number, number] | null;
  /** Draw tile-aligned checkerboard behind commands (replaces solid background). */
  showCheckerboard?: boolean;
  /** Draw tile grid lines and map-space coordinate labels after commands. */
  showCoordinates?: boolean;
  /** Transparent per-frame icon crops used for alpha-safe silhouette filtering. */
  iconImages?: ReadonlyMap<number, CanvasImageSource>;
  /** Padded, dilated black silhouettes keyed by icon frame index. */
  silhouetteImages?: ReadonlyMap<number, CanvasImageSource>;
  /**
   * Frame table from the RenderDb that produced `list`. Required for trim math;
   * not in the CONTRACTS.md sketch — see M1 report.
   */
  frames: FrameMeta[];
  /** Optional canvas factory for offscreen tint compositing (Node/skia). */
  createCanvas?: (
    width: number,
    height: number,
  ) => {
    width: number;
    height: number;
    getContext(type: "2d"): Canvas2DContextLike | null;
  };
  /** Shadow scratch-tile edge length. Defaults to 1024 px. */
  shadowTileSize?: number;
  /** Optional mutable performance counters populated during painting. */
  stats?: ExecuteDrawListStats;
}

export interface ExecuteDrawListStats {
  shadowRuns: number;
  shadowTiles: number;
  shadowCompositedPixels: number;
  shadowPeakScratchPixels: number;
}

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

function rgba([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
}

function drawRect(
  ctx: Canvas2DContextLike,
  cmd: RectCmd,
  ox: number,
  oy: number,
  ppt: number,
): void {
  ctx.fillStyle = rgba(cmd.color);
  ctx.fillRect((cmd.x + ox) * ppt, (cmd.y + oy) * ppt, cmd.w * ppt, cmd.h * ppt);
}

function drawSprite(
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

  const scaleX = frame.sw === 0 ? 0 : dw / frame.sw;
  const scaleY = frame.sh === 0 ? 0 : dh / frame.sh;
  const trimmedDx = dx + frame.ox * scaleX;
  const trimmedDy = dy + frame.oy * scaleY;
  const trimmedDw = frame.w * scaleX;
  const trimmedDh = frame.h * scaleY;

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
      frame.x,
      frame.y,
      packedWidth(frame),
      packedHeight(frame),
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

function shadowSpriteBounds(
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

function drawWire(
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

function drawTrainChain(
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

function drawIcon(
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

/**
 * Execute a sorted draw list against a Canvas2D context.
 * `images[i]` is the atlas image for atlas index i.
 */
export function executeDrawList(
  ctx: Canvas2DContextLike,
  list: DrawList,
  images: CanvasImageSource[],
  opts: ExecuteDrawListOptions,
): void {
  const ppt = opts.pixelsPerTile;
  const pad = opts.padTiles ?? 0;
  const { frames } = opts;
  const { minX, minY, maxX, maxY } = list.bounds;
  const frame = opts.tileFrame ?? {
    minX: Math.floor(minX) - pad,
    minY: Math.floor(minY) - pad,
    maxX: Math.ceil(maxX) + pad,
    maxY: Math.ceil(maxY) + pad,
  };
  const ox = -frame.minX;
  const oy = -frame.minY;
  const width = Math.max(0, (frame.maxX - frame.minX) * ppt);
  const height = Math.max(0, (frame.maxY - frame.minY) * ppt);
  const shadowTileSize = Math.max(1, Math.floor(opts.shadowTileSize ?? 1024));
  const stats = opts.stats;
  if (stats) {
    stats.shadowRuns = 0;
    stats.shadowTiles = 0;
    stats.shadowCompositedPixels = 0;
    stats.shadowPeakScratchPixels = 0;
  }

  // Nearest-neighbor: Factorio sprites are pixel art; bilinear filtering turns
  // rotated/foreshortened hands into a soft "motion blur" smear.
  ctx.imageSmoothingEnabled = false;

  if (opts.showCheckerboard) {
    drawTileCheckerboard(ctx, width, height, ppt);
  } else if (opts.background) {
    ctx.fillStyle = rgba(opts.background);
    ctx.fillRect(0, 0, width, height);
  }

  // Flatten shadow overlap at full opacity, then apply the combined result at
  // 50%. A single reusable tile bounds scratch memory independently of output
  // dimensions while retaining the old overlap semantics.
  let shadowCanvas:
    | {
        width: number;
        height: number;
        getContext(type: "2d"): Canvas2DContextLike | null;
      }
    | undefined;
  let shadowCtx: Canvas2DContextLike | null = null;
  const renderShadowRun = (commands: SpriteCmd[]): void => {
    if (!opts.createCanvas || commands.length === 0 || width <= 0 || height <= 0) return;
    const tileWidth = Math.min(shadowTileSize, Math.ceil(width));
    const tileHeight = Math.min(shadowTileSize, Math.ceil(height));
    if (!shadowCanvas) {
      shadowCanvas = opts.createCanvas(tileWidth, tileHeight);
      shadowCanvas.width = tileWidth;
      shadowCanvas.height = tileHeight;
      shadowCtx = shadowCanvas.getContext("2d");
      if (shadowCtx) shadowCtx.imageSmoothingEnabled = false;
    }
    if (!shadowCtx || !shadowCanvas) return;

    const columns = Math.ceil(width / shadowTileSize);
    const bins = new Map<number, SpriteCmd[]>();
    for (const command of commands) {
      const spriteFrame = frames[command.frame];
      const image = spriteFrame ? images[spriteFrame.a] : undefined;
      if (!spriteFrame || !image) continue;
      const bounds = shadowSpriteBounds(command, spriteFrame, ox, oy, ppt, width, height);
      if (!bounds) continue;
      const minTileX = Math.floor(bounds.minX / shadowTileSize);
      const minTileY = Math.floor(bounds.minY / shadowTileSize);
      const maxTileX = Math.floor((bounds.maxX - 1) / shadowTileSize);
      const maxTileY = Math.floor((bounds.maxY - 1) / shadowTileSize);
      for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
          const key = tileY * columns + tileX;
          const bin = bins.get(key);
          if (bin) bin.push(command);
          else bins.set(key, [command]);
        }
      }
    }

    if (stats) {
      stats.shadowRuns++;
      stats.shadowPeakScratchPixels = Math.max(
        stats.shadowPeakScratchPixels,
        shadowCanvas.width * shadowCanvas.height,
      );
    }
    const prevAlpha = ctx.globalAlpha;
    for (const [key, tileCommands] of [...bins].sort((a, b) => a[0] - b[0])) {
      const tileX = key % columns;
      const tileY = Math.floor(key / columns);
      const outputX = tileX * shadowTileSize;
      const outputY = tileY * shadowTileSize;
      const outputTileWidth = Math.min(shadowTileSize, width - outputX);
      const outputTileHeight = Math.min(shadowTileSize, height - outputY);

      shadowCtx.clearRect(0, 0, shadowCanvas.width, shadowCanvas.height);
      shadowCtx.save();
      shadowCtx.translate(-outputX, -outputY);
      for (const command of tileCommands) {
        const spriteFrame = frames[command.frame];
        const image = spriteFrame ? images[spriteFrame.a] : undefined;
        if (!spriteFrame || !image) continue;
        drawSprite(
          shadowCtx,
          { ...command, shadow: false },
          spriteFrame,
          image,
          ox,
          oy,
          ppt,
          opts.createCanvas,
        );
      }
      shadowCtx.restore();

      ctx.globalAlpha = prevAlpha * 0.5;
      ctx.drawImage(
        shadowCanvas as unknown as CanvasImageSource,
        0,
        0,
        outputTileWidth,
        outputTileHeight,
        outputX,
        outputY,
        outputTileWidth,
        outputTileHeight,
      );
      if (stats) {
        stats.shadowTiles++;
        stats.shadowCompositedPixels += outputTileWidth * outputTileHeight;
      }
    }
    ctx.globalAlpha = prevAlpha;
  };

  for (let commandIndex = 0; commandIndex < list.commands.length; commandIndex++) {
    const cmd = list.commands[commandIndex]!;
    if (cmd.kind === "sprite" && cmd.shadow && opts.createCanvas) {
      const shadowRun: SpriteCmd[] = [];
      while (commandIndex < list.commands.length) {
        const candidate = list.commands[commandIndex];
        if (candidate?.kind !== "sprite" || !candidate.shadow) break;
        shadowRun.push(candidate);
        commandIndex++;
      }
      commandIndex--;
      renderShadowRun(shadowRun);
      continue;
    }
    switch (cmd.kind) {
      case "rect":
        drawRect(ctx, cmd, ox, oy, ppt);
        break;
      case "sprite": {
        const frame = frames[cmd.frame];
        const image = frame ? images[frame.a] : undefined;
        if (!frame || !image) break;
        drawSprite(ctx, cmd, frame, image, ox, oy, ppt, opts.createCanvas);
        break;
      }
      case "wire":
        drawWire(ctx, cmd, ox, oy, ppt);
        break;
      case "train-chain":
        drawTrainChain(ctx, cmd, ox, oy, ppt);
        break;
      case "icon": {
        const frame = frames[cmd.frame];
        const image = frame ? images[frame.a] : undefined;
        if (!frame || !image) break;
        drawIcon(
          ctx,
          cmd,
          frame,
          image,
          frames,
          images,
          opts.iconImages?.get(cmd.frame),
          opts.silhouetteImages?.get(cmd.frame),
          ox,
          oy,
          ppt,
        );
        break;
      }
    }
  }

  if (opts.showCoordinates) {
    drawCoordinateOverlay(ctx, frame, ppt, width, height);
  }
}
