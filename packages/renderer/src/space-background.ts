import type { Canvas2DContextLike } from "./canvas2d.js";
import type { FrameMeta } from "./types/render-db.js";

const SPACE_FILL = "#000000";
/** One candidate star cell; sparse occupancy mimics Factorio's space-rear-star look. */
const STAR_CELL = 28;
const STAR_OCCUPANCY = 0.11;

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
): void {
  if (width <= 0 || height <= 0) return;
  const { frame, image } = planet;
  if (frame.sw <= 0 || frame.sh <= 0 || frame.w <= 0 || frame.h <= 0) return;

  const radius = Math.max(PLANET_MIN_RADIUS_PX, PLANET_RADIUS_FRACTION * Math.min(width, height));
  const cx = width / 2 + PLANET_OFFSET_X_OVER_RADIUS * radius;
  const cy = height / 2 + PLANET_OFFSET_Y_OVER_RADIUS * radius;
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

/** Fill `width`×`height` with a black starfield; star positions are stable across rerenders. */
export function drawSpaceBackground(
  ctx: Canvas2DContextLike,
  width: number,
  height: number,
  options?: DrawSpaceBackgroundOptions,
): void {
  if (width <= 0 || height <= 0) return;
  ctx.fillStyle = SPACE_FILL;
  ctx.fillRect(0, 0, width, height);

  const columns = Math.ceil(width / STAR_CELL);
  const rows = Math.ceil(height / STAR_CELL);
  for (let cellY = 0; cellY < rows; cellY++) {
    for (let cellX = 0; cellX < columns; cellX++) {
      if (cellHash(cellX, cellY, 1) > STAR_OCCUPANCY) continue;
      const brightness = 0.45 + cellHash(cellX, cellY, 2) * 0.55;
      const channel = Math.round(brightness * 255);
      const size = cellHash(cellX, cellY, 3) > 0.88 ? 2 : 1;
      const x =
        cellX * STAR_CELL + Math.floor(cellHash(cellX, cellY, 4) * Math.max(1, STAR_CELL - size));
      const y =
        cellY * STAR_CELL + Math.floor(cellHash(cellX, cellY, 5) * Math.max(1, STAR_CELL - size));
      if (x >= width || y >= height) continue;
      ctx.fillStyle = `rgb(${channel},${channel},${channel})`;
      ctx.fillRect(x, y, Math.min(size, width - x), Math.min(size, height - y));
    }
  }

  if (options?.planet) drawSpacePlanet(ctx, width, height, options.planet);
}
