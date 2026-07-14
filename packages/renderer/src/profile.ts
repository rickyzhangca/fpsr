import type { TileFrame } from "./frame.js";

/** High-resolution clock; falls back to Date.now in exotic hosts. */
export function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** Best-effort Performance API mark (ignored when unavailable). */
export function perfMark(name: string): void {
  try {
    performance.mark?.(name);
  } catch {
    // ignore
  }
}

/** Best-effort Performance API measure between two marks. */
export function perfMeasure(name: string, startMark: string, endMark: string): void {
  try {
    performance.measure?.(name, startMark, endMark);
  } catch {
    // ignore
  }
}

export interface DecodeStats {
  mode: "compressed" | "json";
  inputChars: number;
  /** Base64-decoded zlib payload length (compressed mode only). */
  compressedBytes?: number;
  /** Inflated UTF-8 byte length (compressed mode only). */
  inflatedBytes?: number;
  /** JSON text character length. */
  jsonChars: number;
  /** inflatedBytes / compressedBytes when both known. */
  compressionRatio?: number;
  timings: {
    totalMs: number;
    base64Ms?: number;
    inflateMs?: number;
    utf8Ms?: number;
    jsonParseMs: number;
    validateMs: number;
  };
}

export interface PlanProfile {
  migrateMs: number;
  resolveMs: number;
  tilesMs: number;
  entitiesMs: number;
  overlaysMs: number;
  sortMs: number;
  totalMs: number;
}

export type AssetEventKind = "render-db" | "manifest" | "atlas";

export interface AssetEvent {
  kind: AssetEventKind;
  /** Atlas index when kind === "atlas". */
  index?: number;
  url?: string;
  cached: boolean;
  fetchMs?: number;
  /** Time spent waiting for an available image decoder slot. */
  queueMs?: number;
  decodeMs?: number;
  /** Decoded atlas area, independent of compressed blob size. */
  decodedPixels?: number;
  totalMs: number;
  bytes?: number;
}

export interface DrawListStats {
  commandCount: number;
  byKind: Record<string, number>;
  uniqueFrames: number;
  /** layer number → command count */
  layerHistogram: Record<string, number>;
  atlasIndices: number[];
}

export interface RenderProfile {
  selectMs: number;
  plan: PlanProfile;
  assets: AssetEvent[];
  /** Wall-clock for the parallel atlas load phase (not sum of per-atlas times). */
  assetsMs: number;
  iconBakeMs: number;
  iconBakeCount: number;
  silhouetteBakeCount: number;
  iconCacheHits: number;
  iconCacheMisses: number;
  silhouetteCacheHits: number;
  silhouetteCacheMisses: number;
  frameMs: number;
  paintMs: number;
  shadow: {
    runs: number;
    tiles: number;
    compositedPixels: number;
    peakScratchPixels: number;
  };
  totalMs: number;
  /** True when any atlas referenced by this render was not already cached. */
  cold: boolean;
  drawList: DrawListStats;
  output: {
    width: number;
    height: number;
    megapixels: number;
    pixelsPerTile: number;
    tileFrame: TileFrame;
  };
  db: {
    entityDefs: number;
    tileDefs: number;
    frameCount: number;
    atlasCount: number;
  };
}
