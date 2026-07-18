import type { PreviewRenderResult } from "./preview-renderer";

export type ExportFormat = "webp" | "png";

export const WEBP_QUALITY = 0.9;

export const EXPORT_OPTIONS = {
  webp: { type: "image/webp", quality: WEBP_QUALITY },
  png: { type: "image/png" },
} as const;

export const exportFormatLabel = (format: ExportFormat): "WebP" | "PNG" => {
  return format === "webp" ? "WebP" : "PNG";
};

export const formatExportSize = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatSurfaceMemory = (width: number, height: number): string => {
  const bytes = width * height * 4;
  return bytes < 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(0)} MB`
    : `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

export const resultPixelsPerTile = (result: PreviewRenderResult): number => {
  const tilesX = result.tileFrame.maxX - result.tileFrame.minX;
  return tilesX > 0 ? result.width / tilesX : 32;
};

export const formatTileSize = (result: PreviewRenderResult | null): string => {
  if (!result) return "—";
  const { tileFrame } = result;
  return `${tileFrame.maxX - tileFrame.minX}×${tileFrame.maxY - tileFrame.minY} tiles`;
};
