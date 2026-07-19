import type { RenderMeasurement, TileFrame } from "@rickyzhangca/fpsr";

export const FULL_PREVIEW_PIXELS_PER_TILE = 64;
export const PREVIEW_TILE_BITMAP_PIXELS = 512;
export const PREVIEW_TILE_LODS = [1, 2, 4, 8, 16, 32, 64] as const;

export type PreviewTilePixelsPerTile = (typeof PREVIEW_TILE_LODS)[number];

export interface TiledPreviewViewport {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

export interface PreviewTileDescriptor {
  key: string;
  column: number;
  row: number;
  pixelsPerTile: PreviewTilePixelsPerTile;
  tileFrame: TileFrame;
  fullPixelX: number;
  fullPixelY: number;
  fullPixelWidth: number;
  fullPixelHeight: number;
  distanceFromCenter: number;
}

export const previewTileWorldTiles = (pixelsPerTile: PreviewTilePixelsPerTile): number =>
  PREVIEW_TILE_BITMAP_PIXELS / pixelsPerTile;

export function selectPreviewPixelsPerTile(
  zoom: number,
  devicePixelRatio: number,
): PreviewTilePixelsPerTile {
  const desired = FULL_PREVIEW_PIXELS_PER_TILE * Math.max(0, zoom) * Math.max(1, devicePixelRatio);
  return PREVIEW_TILE_LODS.find((value) => value >= desired) ?? FULL_PREVIEW_PIXELS_PER_TILE;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export function visiblePreviewTiles(
  measurement: RenderMeasurement,
  viewport: TiledPreviewViewport,
  pixelsPerTile: PreviewTilePixelsPerTile,
  overscanTiles = 1,
): PreviewTileDescriptor[] {
  if (
    viewport.zoom <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    measurement.width <= 0 ||
    measurement.height <= 0
  ) {
    return [];
  }

  const { tileFrame } = measurement;
  const worldTilesPerChunk = previewTileWorldTiles(pixelsPerTile);
  const fullPixelsPerChunk = worldTilesPerChunk * FULL_PREVIEW_PIXELS_PER_TILE;
  const columns = Math.ceil((tileFrame.maxX - tileFrame.minX) / worldTilesPerChunk);
  const rows = Math.ceil((tileFrame.maxY - tileFrame.minY) / worldTilesPerChunk);
  if (columns <= 0 || rows <= 0) return [];

  const contentCenterX = measurement.width / 2 - viewport.panX / viewport.zoom;
  const contentCenterY = measurement.height / 2 - viewport.panY / viewport.zoom;
  const visibleHalfWidth = viewport.width / viewport.zoom / 2;
  const visibleHalfHeight = viewport.height / viewport.zoom / 2;
  const minPixelX = clamp(contentCenterX - visibleHalfWidth, 0, measurement.width);
  const maxPixelX = clamp(contentCenterX + visibleHalfWidth, 0, measurement.width);
  const minPixelY = clamp(contentCenterY - visibleHalfHeight, 0, measurement.height);
  const maxPixelY = clamp(contentCenterY + visibleHalfHeight, 0, measurement.height);

  const firstColumn = clamp(
    Math.floor(minPixelX / fullPixelsPerChunk) - overscanTiles,
    0,
    columns - 1,
  );
  const lastColumn = clamp(
    Math.floor(Math.max(0, maxPixelX - 1) / fullPixelsPerChunk) + overscanTiles,
    0,
    columns - 1,
  );
  const firstRow = clamp(Math.floor(minPixelY / fullPixelsPerChunk) - overscanTiles, 0, rows - 1);
  const lastRow = clamp(
    Math.floor(Math.max(0, maxPixelY - 1) / fullPixelsPerChunk) + overscanTiles,
    0,
    rows - 1,
  );

  const descriptors: PreviewTileDescriptor[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      const minX = tileFrame.minX + column * worldTilesPerChunk;
      const minY = tileFrame.minY + row * worldTilesPerChunk;
      const maxX = Math.min(tileFrame.maxX, minX + worldTilesPerChunk);
      const maxY = Math.min(tileFrame.maxY, minY + worldTilesPerChunk);
      const fullPixelX = column * fullPixelsPerChunk;
      const fullPixelY = row * fullPixelsPerChunk;
      const fullPixelWidth = (maxX - minX) * FULL_PREVIEW_PIXELS_PER_TILE;
      const fullPixelHeight = (maxY - minY) * FULL_PREVIEW_PIXELS_PER_TILE;
      const tileCenterX = fullPixelX + fullPixelWidth / 2;
      const tileCenterY = fullPixelY + fullPixelHeight / 2;
      descriptors.push({
        key: `${pixelsPerTile}:${column}:${row}`,
        column,
        row,
        pixelsPerTile,
        tileFrame: { minX, minY, maxX, maxY },
        fullPixelX,
        fullPixelY,
        fullPixelWidth,
        fullPixelHeight,
        distanceFromCenter: Math.hypot(tileCenterX - contentCenterX, tileCenterY - contentCenterY),
      });
    }
  }
  return descriptors.sort((left, right) => left.distanceFromCenter - right.distanceFromCenter);
}
