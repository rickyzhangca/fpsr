/**
 * Canvas2D execution subpath: `@rickyzhangca/fpsr/canvas`.
 */

export { executeDrawList } from "./canvas2d.js";
export type {
  Canvas2DContextLike,
  ExecuteDrawListOptions,
  ExecuteDrawListStats,
} from "./canvas2d.js";

export {
  bakeEntityInfoSilhouette,
  ENTITY_INFO_SILHOUETTE_BLUR_PX,
  ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  entityInfoSilhouettePadPx,
} from "./icon-silhouette.js";

export { drawCoordinateOverlay } from "./coordinate-overlay.js";

export { blitWithTileCheckerboard, drawTileCheckerboard } from "./checkerboard.js";
export { drawSpaceBackground, drawSpacePlanet } from "./space-background.js";
export type { DrawSpaceBackgroundOptions, SpacePlanetDecoration } from "./space-background.js";
export { drawTerrainBackground } from "./terrain-background.js";
export type { DrawTerrainBackgroundOptions } from "./terrain-background.js";

export { nowMs, perfMark, perfMeasure } from "./profile.js";
