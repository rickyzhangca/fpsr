import type { Canvas2DContextLike } from "./canvas2d.js";
import type { FrameMeta } from "./types/render-db.js";

const SPACE_FILL = "#000000";
const DEFAULT_STAR_SEED = 0x51f1_5e77;

interface StarLayer {
  cellSize: number;
  occupancy: number;
  brightness: [number, number];
  largeChance: number;
  salt: number;
}

/** Incommensurate grids overlap into a starfield without a visible repeated lattice. */
const STAR_LAYERS: readonly StarLayer[] = [
  { cellSize: 17, occupancy: 0.06, brightness: [0.24, 0.5], largeChance: 0, salt: 11 },
  { cellSize: 37, occupancy: 0.13, brightness: [0.42, 0.76], largeChance: 0.04, salt: 29 },
  { cellSize: 79, occupancy: 0.28, brightness: [0.68, 1], largeChance: 0.36, salt: 47 },
];

/**
 * Factorio `platform_backdrop` placement for Nauvis, expressed relative to
 * screen center with radius 600 on a ~1920×1080 reference viewport:
 * `position = {-680, 601}`, `radius = 600`.
 */
const PLANET_OFFSET_X_OVER_RADIUS = -680 / 600;
const PLANET_OFFSET_Y_OVER_RADIUS = 601 / 600;
/** Planet radius as a fraction of the shorter canvas edge. */
const PLANET_RADIUS_FRACTION = 0.5;
/** Floor so tiny previews still get a readable bottom-left peek. */
const PLANET_MIN_RADIUS_PX = 140;

function packedWidth(frame: FrameMeta): number {
  return frame.pw ?? frame.w;
}

function packedHeight(frame: FrameMeta): number {
  return frame.ph ?? frame.h;
}

/** Deterministic 0..1 hash from integer cell coordinates. */
const cellHash = (cellX: number, cellY: number, salt: number): number => {
  let h = Math.imul(cellX, 374761393) ^ Math.imul(cellY, 668265263) ^ Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface SpacePlanetDecoration {
  frame: FrameMeta;
  image: CanvasImageSource;
}

export interface DrawSpaceBackgroundOptions {
  /** Optional starmap planet drawn bottom-left after the starfield. */
  planet?: SpacePlanetDecoration;
  /** Stable salt; selected planets use different skies while rerenders remain reproducible. */
  seed?: number;
  /** Full output dimensions and this viewport's offset within it (for tiled rendering). */
  viewport?: {
    x: number;
    y: number;
    fullWidth: number;
    fullHeight: number;
  };
}

/**
 * Draw the space-platform planet peeking from the bottom-left, matching
 * Factorio's backdrop offset ratios scaled to the canvas.
 */
export function drawSpacePlanet(
  ctx: Canvas2DContextLike,
  width: number,
  height: number,
  planet: SpacePlanetDecoration,
  viewport?: DrawSpaceBackgroundOptions["viewport"],
): void {
  if (width <= 0 || height <= 0) return;
  const { frame, image } = planet;
  if (frame.sw <= 0 || frame.sh <= 0 || frame.w <= 0 || frame.h <= 0) return;

  const fullWidth = viewport?.fullWidth ?? width;
  const fullHeight = viewport?.fullHeight ?? height;
  const radius = Math.max(
    PLANET_MIN_RADIUS_PX,
    PLANET_RADIUS_FRACTION * Math.min(fullWidth, fullHeight),
  );
  const cx = fullWidth / 2 + PLANET_OFFSET_X_OVER_RADIUS * radius - (viewport?.x ?? 0);
  const cy = fullHeight / 2 + PLANET_OFFSET_Y_OVER_RADIUS * radius - (viewport?.y ?? 0);
  const logicalSize = radius * 2;
  const scale = logicalSize / Math.max(frame.sw, frame.sh);

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    image,
    frame.x,
    frame.y,
    packedWidth(frame),
    packedHeight(frame),
    cx - radius + frame.ox * scale,
    cy - radius + frame.oy * scale,
    frame.w * scale,
    frame.h * scale,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Smooth low-frequency value noise used only to vary local star density. */
function densityNoise(x: number, y: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const tx = smoothstep(x - cellX);
  const ty = smoothstep(y - cellY);
  const top = lerp(cellHash(cellX, cellY, seed), cellHash(cellX + 1, cellY, seed), tx);
  const bottom = lerp(cellHash(cellX, cellY + 1, seed), cellHash(cellX + 1, cellY + 1, seed), tx);
  return lerp(top, bottom, ty);
}

function starDensity(x: number, y: number, seed: number): number {
  const broad = densityNoise(x / 310, y / 310, seed ^ 0x6d2b_79f5);
  const detail = densityNoise(x / 137, y / 137, seed ^ 0x1b87_3593);
  return 0.36 + (broad * 0.68 + detail * 0.32) * 0.88;
}

function drawStar(
  ctx: Canvas2DContextLike,
  width: number,
  height: number,
  x: number,
  y: number,
  size: number,
  color: string,
  sparkle: boolean,
): void {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const clippedWidth = Math.min(width, x + size) - left;
  const clippedHeight = Math.min(height, y + size) - top;
  if (clippedWidth <= 0 || clippedHeight <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(left, top, clippedWidth, clippedHeight);
  if (!sparkle) return;
  ctx.fillRect(x - 1, y, 4, 1);
  ctx.fillRect(x, y - 1, 1, 4);
}

/** Fill `width`×`height` with a layered deterministic starfield. */
export function drawSpaceBackground(
  ctx: Canvas2DContextLike,
  width: number,
  height: number,
  options?: DrawSpaceBackgroundOptions,
): void {
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = SPACE_FILL;
  ctx.fillRect(0, 0, width, height);

  const seed = options?.seed == null ? DEFAULT_STAR_SEED : options.seed >>> 0;
  const viewportX = options?.viewport?.x ?? 0;
  const viewportY = options?.viewport?.y ?? 0;
  for (const layer of STAR_LAYERS) {
    const firstCellX = Math.max(0, Math.floor(viewportX / layer.cellSize) - 1);
    const firstCellY = Math.max(0, Math.floor(viewportY / layer.cellSize) - 1);
    const lastCellX = Math.ceil((viewportX + width) / layer.cellSize);
    const lastCellY = Math.ceil((viewportY + height) / layer.cellSize);
    const layerSeed = seed ^ Math.imul(layer.salt, 0x9e37_79b1);
    for (let cellY = firstCellY; cellY < lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX < lastCellX; cellX++) {
        const xUnit = cellHash(cellX, cellY, layerSeed ^ 2);
        const yUnit = cellHash(cellX, cellY, layerSeed ^ 3);
        const globalX = cellX * layer.cellSize + Math.floor(xUnit * layer.cellSize);
        const globalY = cellY * layer.cellSize + Math.floor(yUnit * layer.cellSize);
        const density = starDensity(globalX, globalY, seed);
        if (cellHash(cellX, cellY, layerSeed ^ 1) > layer.occupancy * density) continue;

        const brightness = lerp(
          layer.brightness[0],
          layer.brightness[1],
          cellHash(cellX, cellY, layerSeed ^ 4),
        );
        const warmth = cellHash(cellX, cellY, layerSeed ^ 5) - 0.5;
        const red = Math.round(Math.min(1, brightness * (1 + warmth * 0.12)) * 255);
        const green = Math.round(brightness * (1 - Math.abs(warmth) * 0.035) * 255);
        const blue = Math.round(Math.min(1, brightness * (1 - warmth * 0.16)) * 255);
        const size = cellHash(cellX, cellY, layerSeed ^ 6) < layer.largeChance ? 2 : 1;
        const sparkle = size === 2 && cellHash(cellX, cellY, layerSeed ^ 7) > 0.86;
        drawStar(
          ctx,
          width,
          height,
          globalX - viewportX,
          globalY - viewportY,
          size,
          `rgb(${red},${green},${blue})`,
          sparkle,
        );
      }
    }
  }

  if (options?.planet) drawSpacePlanet(ctx, width, height, options.planet, options.viewport);
}
