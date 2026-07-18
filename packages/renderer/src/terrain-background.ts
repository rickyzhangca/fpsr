import type { Canvas2DContextLike } from "./canvas2d.js";
import type { TileFrame } from "./frame.js";
import type { FrameMeta, TerrainPatchBackground } from "./types/render-db.js";

const UINT32_RANGE = 4_294_967_296;

function packedWidth(frame: FrameMeta): number {
  return frame.pw ?? frame.w;
}

function packedHeight(frame: FrameMeta): number {
  return frame.ph ?? frame.h;
}

/** Stable unsigned hash for an absolute terrain-patch cell. */
function terrainCellHash(cellX: number, cellY: number): number {
  let hash = (Math.imul(cellX | 0, 374_761_393) + Math.imul(cellY | 0, 668_265_263)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function selectVariant(cellX: number, cellY: number, background: TerrainPatchBackground): number {
  const { frames, weights } = background;
  const unit = terrainCellHash(cellX, cellY) / UINT32_RANGE;
  if (!weights || weights.length !== frames.length) {
    return Math.min(frames.length - 1, Math.floor(unit * frames.length));
  }

  let total = 0;
  for (const weight of weights) {
    if (Number.isFinite(weight) && weight > 0) total += weight;
  }
  if (total <= 0) return Math.min(frames.length - 1, Math.floor(unit * frames.length));

  let target = unit * total;
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index] ?? 0;
    if (Number.isFinite(weight) && weight > 0) {
      target -= weight;
      if (target < 0) return index;
    }
  }
  return frames.length - 1;
}

function rgba(color: [number, number, number, number]): string {
  const [r, g, b, a] = color;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

export interface DrawTerrainBackgroundOptions {
  tileFrame: TileFrame;
  pixelsPerTile: number;
  frames: FrameMeta[];
  images: CanvasImageSource[];
  background?: TerrainPatchBackground;
  fallbackColor: [number, number, number, number];
}

/**
 * Paint an infinite terrain plane anchored to absolute map coordinates.
 * Patches outside the viewport are intentionally drawn and clipped by Canvas,
 * so changing blueprint bounds or padding never shifts the terrain underneath.
 */
export function drawTerrainBackground(
  ctx: Canvas2DContextLike,
  width: number,
  height: number,
  options: DrawTerrainBackgroundOptions,
): void {
  if (width <= 0 || height <= 0) return;

  const { background, fallbackColor, frames, images, pixelsPerTile, tileFrame } = options;
  ctx.fillStyle = rgba(background?.color ?? fallbackColor);
  ctx.fillRect(0, 0, width, height);
  if (!background || background.frames.length === 0 || !(background.patchSize > 0)) return;

  const patchSize = Math.max(1, Math.floor(background.patchSize));
  const firstCellX = Math.floor(tileFrame.minX / patchSize);
  const firstCellY = Math.floor(tileFrame.minY / patchSize);
  const lastCellX = Math.ceil(tileFrame.maxX / patchSize);
  const lastCellY = Math.ceil(tileFrame.maxY / patchSize);
  const patchPixels = patchSize * pixelsPerTile;
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  for (let cellY = firstCellY; cellY < lastCellY; cellY++) {
    for (let cellX = firstCellX; cellX < lastCellX; cellX++) {
      const variantIndex = selectVariant(cellX, cellY, background);
      const frameId = background.frames[variantIndex];
      const frame = frameId == null ? undefined : frames[frameId];
      const image = frame ? images[frame.a] : undefined;
      if (!frame || !image || frame.sw <= 0 || frame.sh <= 0) continue;

      const worldX = cellX * patchSize;
      const worldY = cellY * patchSize;
      const patchX = (worldX - tileFrame.minX) * pixelsPerTile;
      const patchY = (worldY - tileFrame.minY) * pixelsPerTile;
      const scaleX = patchPixels / frame.sw;
      const scaleY = patchPixels / frame.sh;

      ctx.drawImage(
        image,
        frame.x,
        frame.y,
        packedWidth(frame),
        packedHeight(frame),
        patchX + frame.ox * scaleX,
        patchY + frame.oy * scaleY,
        frame.w * scaleX,
        frame.h * scaleY,
      );
    }
  }

  ctx.imageSmoothingEnabled = previousSmoothing;
}
