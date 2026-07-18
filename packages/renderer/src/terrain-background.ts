import type { Canvas2DContextLike } from "./canvas2d.js";
import type { TileFrame } from "./frame.js";
import type { FrameMeta, TerrainPatchBackground, TerrainPatchSet } from "./types/render-db.js";

const UINT32_RANGE = 4_294_967_296;
const VARIANT_SALT = 0x9e37_79b9;
const PATCH_SIZE_SALT = 0x85eb_ca6b;
/** Keep enough smaller patches in uniform terrain to break up large repeated motifs. */
const MAX_LARGEST_PATCH_PROBABILITY = 0.4;
const MAX_INTERMEDIATE_PATCH_PROBABILITY = 0.7;

function packedWidth(frame: FrameMeta): number {
  return frame.pw ?? frame.w;
}

function packedHeight(frame: FrameMeta): number {
  return frame.ph ?? frame.h;
}

/** Stable unsigned hash for an absolute terrain-patch cell and background salt. */
function terrainCellHash(cellX: number, cellY: number, salt: number): number {
  let hash =
    (Math.imul(cellX | 0, 374_761_393) ^
      Math.imul(cellY | 0, 668_265_263) ^
      Math.imul(salt | 0, 1_597_334_677)) |
    0;
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Derive a fallback salt for pre-seed render databases without coupling terrain types. */
function terrainSeed(background: TerrainPatchBackground): number {
  if (Number.isFinite(background.seed)) return (background.seed ?? 0) >>> 0;
  let seed = 2_166_136_261;
  for (const patch of [background, ...(background.patches ?? [])]) {
    seed = Math.imul(seed ^ Math.floor(patch.patchSize), 16_777_619) >>> 0;
    for (const frame of patch.frames) {
      seed = Math.imul(seed ^ ((frame + 1) >>> 0), 16_777_619) >>> 0;
    }
  }
  return seed >>> 0;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

/**
 * Split four-or-more variants into two seed-permuted pools on a checkerboard.
 * Direct neighbours cannot select the exact same authored frame, while selection
 * within each pool remains hashed and weighted.
 */
function variantCandidates(count: number, cellX: number, cellY: number, seed: number): number[] {
  if (count < 4) return Array.from({ length: count }, (_, index) => index);

  let stride = ((seed >>> 8) % count) | 1;
  while (greatestCommonDivisor(stride, count) !== 1) stride += 2;
  const offset = (seed >>> 16) % count;
  const parity = (cellX + cellY) & 1;
  const candidates: number[] = [];
  for (let logical = parity; logical < count; logical += 2) {
    candidates.push((logical * stride + offset) % count);
  }
  return candidates;
}

function selectVariant(cellX: number, cellY: number, patch: TerrainPatchSet, seed: number): number {
  const candidates = variantCandidates(patch.frames.length, cellX, cellY, seed);
  const unit = terrainCellHash(cellX, cellY, seed ^ VARIANT_SALT) / UINT32_RANGE;
  const { weights } = patch;
  if (!weights || weights.length !== patch.frames.length) {
    return candidates[Math.min(candidates.length - 1, Math.floor(unit * candidates.length))] ?? 0;
  }

  let total = 0;
  for (const index of candidates) {
    const weight = weights[index] ?? 0;
    if (Number.isFinite(weight) && weight > 0) total += weight;
  }
  if (total <= 0) {
    return candidates[Math.min(candidates.length - 1, Math.floor(unit * candidates.length))] ?? 0;
  }

  let target = unit * total;
  for (const index of candidates) {
    const weight = weights[index] ?? 0;
    if (Number.isFinite(weight) && weight > 0) {
      target -= weight;
      if (target < 0) return index;
    }
  }
  return candidates[candidates.length - 1] ?? 0;
}

function terrainPatchSets(background: TerrainPatchBackground): TerrainPatchSet[] {
  const unique = new Map<number, TerrainPatchSet>();
  for (const patch of [background, ...(background.patches ?? [])]) {
    const patchSize = Math.floor(patch.patchSize);
    if (patchSize > 0 && patch.frames.length > 0 && !unique.has(patchSize)) {
      unique.set(patchSize, {
        patchSize,
        frames: patch.frames,
        ...(patch.weights ? { weights: patch.weights } : {}),
        ...(patch.probability != null ? { probability: patch.probability } : {}),
      });
    }
  }
  return [...unique.values()].sort((left, right) => right.patchSize - left.patchSize);
}

function patchProbability(patch: TerrainPatchSet, index: number, count: number): number {
  if (index === count - 1) return 1;
  const authored = Number.isFinite(patch.probability)
    ? Math.max(0, Math.min(1, patch.probability ?? 1))
    : 1;
  const cap = index === 0 ? MAX_LARGEST_PATCH_PROBABILITY : MAX_INTERMEDIATE_PATCH_PROBABILITY;
  return Math.min(authored, cap);
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
 * Only complete, untransformed Factorio patches are drawn. Larger regions may
 * be subdivided into complete smaller authored patches, so every destination is
 * covered exactly once and every texture edge keeps its intended orientation.
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
  if (!background) return;

  const patchSets = terrainPatchSets(background);
  const largestPatch = patchSets[0];
  if (!largestPatch) return;

  const seed = terrainSeed(background);
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  const drawPatch = (worldX: number, worldY: number, patch: TerrainPatchSet): void => {
    const cellX = Math.floor(worldX / patch.patchSize);
    const cellY = Math.floor(worldY / patch.patchSize);
    const patchSeed = seed ^ Math.imul(patch.patchSize, PATCH_SIZE_SALT);
    const variantIndex = selectVariant(cellX, cellY, patch, patchSeed);
    const frameId = patch.frames[variantIndex];
    const frame = frameId == null ? undefined : frames[frameId];
    const image = frame ? images[frame.a] : undefined;
    if (!frame || !image || frame.sw <= 0 || frame.sh <= 0) return;

    // `maxOutputSize` can produce a fractional pixelsPerTile. Snap both sides
    // from the same absolute world boundary so neighbouring patches share the
    // exact destination pixel instead of exposing one-pixel background seams.
    const patchLeft = Math.round((worldX - tileFrame.minX) * pixelsPerTile);
    const patchTop = Math.round((worldY - tileFrame.minY) * pixelsPerTile);
    const patchRight = Math.round((worldX + patch.patchSize - tileFrame.minX) * pixelsPerTile);
    const patchBottom = Math.round((worldY + patch.patchSize - tileFrame.minY) * pixelsPerTile);
    const scaleX = (patchRight - patchLeft) / frame.sw;
    const scaleY = (patchBottom - patchTop) / frame.sh;
    ctx.drawImage(
      image,
      frame.x,
      frame.y,
      packedWidth(frame),
      packedHeight(frame),
      patchLeft + frame.ox * scaleX,
      patchTop + frame.oy * scaleY,
      frame.w * scaleX,
      frame.h * scaleY,
    );
  };

  const drawRegion = (
    worldX: number,
    worldY: number,
    regionSize: number,
    patchIndex: number,
  ): void => {
    const patch = patchSets[patchIndex];
    if (!patch) return;

    if (patch.patchSize < regionSize) {
      const step = patch.patchSize;
      for (let offsetY = 0; offsetY < regionSize; offsetY += step) {
        for (let offsetX = 0; offsetX < regionSize; offsetX += step) {
          drawRegion(worldX + offsetX, worldY + offsetY, step, patchIndex);
        }
      }
      return;
    }

    const cellX = Math.floor(worldX / regionSize);
    const cellY = Math.floor(worldY / regionSize);
    const probability = patchProbability(patch, patchIndex, patchSets.length);
    const usePatch =
      probability >= 1 ||
      terrainCellHash(cellX, cellY, seed ^ Math.imul(regionSize, PATCH_SIZE_SALT)) / UINT32_RANGE <
        probability;
    const nextPatch = patchSets[patchIndex + 1];
    if (usePatch || !nextPatch || regionSize % nextPatch.patchSize !== 0) {
      drawPatch(worldX, worldY, patch);
      return;
    }

    const step = nextPatch.patchSize;
    for (let offsetY = 0; offsetY < regionSize; offsetY += step) {
      for (let offsetX = 0; offsetX < regionSize; offsetX += step) {
        drawRegion(worldX + offsetX, worldY + offsetY, step, patchIndex + 1);
      }
    }
  };

  const patchSize = largestPatch.patchSize;
  const firstCellX = Math.floor(tileFrame.minX / patchSize);
  const firstCellY = Math.floor(tileFrame.minY / patchSize);
  const lastCellX = Math.ceil(tileFrame.maxX / patchSize);
  const lastCellY = Math.ceil(tileFrame.maxY / patchSize);
  for (let cellY = firstCellY; cellY < lastCellY; cellY++) {
    for (let cellX = firstCellX; cellX < lastCellX; cellX++) {
      drawRegion(cellX * patchSize, cellY * patchSize, patchSize, 0);
    }
  }

  ctx.imageSmoothingEnabled = previousSmoothing;
}
