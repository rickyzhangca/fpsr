import { drawTileCheckerboard } from "../checkerboard.js";
import { drawCoordinateOverlay } from "../coordinate-overlay.js";
import { drawSpaceBackground } from "../space-background.js";
import { drawTerrainBackground } from "../terrain-background.js";
import type { DrawList, SpriteCmd } from "../types/draw-list.js";
import { drawIcon } from "./draw-icon.js";
import { drawRect, drawSprite, shadowSpriteBounds } from "./draw-sprite.js";
import { drawTrainChain, drawWire } from "./draw-wire.js";
import type { Canvas2DContextLike, ExecuteDrawListOptions } from "./types.js";
import { rgba } from "./util.js";

const TERRAIN_FALLBACK_COLOR: [number, number, number, number] = [
  141 / 255,
  104 / 255,
  60 / 255,
  1,
];

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

  if (opts.showSpace) {
    const planetFrameId = opts.spaceBackground?.planetFrame;
    const planetFrame = planetFrameId != null ? opts.frames[planetFrameId] : undefined;
    const planetImage = planetFrame ? images[planetFrame.a] : undefined;
    drawSpaceBackground(ctx, width, height, {
      planet:
        planetFrame && planetImage
          ? {
              frame: planetFrame,
              image: planetImage,
            }
          : undefined,
    });
  } else if (opts.terrainBackground) {
    drawTerrainBackground(ctx, width, height, {
      tileFrame: frame,
      pixelsPerTile: ppt,
      frames: opts.frames,
      images,
      background: opts.terrainBackground,
      fallbackColor: opts.terrainBackground.color ?? TERRAIN_FALLBACK_COLOR,
    });
  } else if (opts.showCheckerboard) {
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
