import type { AssetSource, AssetTier } from "./assets.js";
import { selectBlueprint } from "./book.js";
import type { Canvas2DContextLike, ExecuteDrawListStats } from "./canvas2d.js";
import * as canvas2d from "./canvas2d.js";
import { computeTileFrame, type TileFrame } from "./frame.js";
import {
  bakeEntityInfoSilhouette,
  bakeEntityInfoSilhouetteFromImageData,
  ENTITY_INFO_SILHOUETTE_BLUR_PX,
  ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  type ImageDataContext,
  type SilhouetteCanvasLike,
} from "./icon-silhouette.js";
import { planDrawList } from "./plan.js";
import {
  nowMs,
  perfMark,
  perfMeasure,
  type AssetEvent,
  type DrawListStats,
  type PlanProfile,
  type RenderProfile,
} from "./profile.js";
import { blueprintPrefersPlatformGraphics } from "./resolve.js";
import type { Blueprint, BlueprintDocument } from "./types/blueprint.js";
import type { DrawList } from "./types/draw-list.js";
import type { RenderDb, SpaceBackground, TerrainPatchBackground } from "./types/render-db.js";

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): Canvas2DContextLike | null;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
  toBuffer?(mime?: string, options?: { quality?: number }): Uint8Array | Promise<Uint8Array>;
}

export type CreateCanvasFn = (width: number, height: number) => CanvasLike;

export type RenderImageMimeType = "image/png" | "image/webp";

export interface RenderImageOptions {
  /** Output image format. Defaults to PNG. */
  type?: RenderImageMimeType;
  /** Encoder quality from 0 to 1 for lossy formats such as WebP. */
  quality?: number;
}

export interface MaxOutputSize {
  width: number;
  height: number;
}

export interface RenderMeasurement {
  tileFrame: TileFrame;
  requestedPixelsPerTile: number;
  pixelsPerTile: number;
  requestedWidth: number;
  requestedHeight: number;
  width: number;
  height: number;
  capped: boolean;
}

export interface CreateRendererOptions {
  assets: AssetSource;
  /** Physical atlas tier. Defaults to 2x. */
  assetTier?: AssetTier;
  /** Preloaded render-db; when omitted, loaded once via assets.loadRenderDb(). */
  renderDb?: RenderDb;
  /** Canvas factory; defaults to OffscreenCanvas / document.createElement. */
  createCanvas?: CreateCanvasFn;
}

export type RenderProgressEvent =
  | { stage: "planning" }
  | { stage: "loading-assets"; completed: number; total: number }
  | { stage: "baking-icons" }
  | { stage: "painting" }
  | { stage: "complete" };

export interface RenderOptions {
  blueprintPath?: number[];
  pixelsPerTile?: number;
  /**
   * Fit the output inside this box by lowering pixelsPerTile before painting.
   * The renderer never creates a full-resolution intermediate canvas.
   */
  maxOutputSize?: MaxOutputSize;
  altMode?: boolean;
  background?: [number, number, number, number] | null;
  padTiles?: number;
  /**
   * When true, pick checkerboard vs space from the blueprint (space platform → space).
   * Overrides the other `show*` background flags.
   */
  showBackgroundAuto?: boolean;
  /** Draw tile-aligned checkerboard behind commands (replaces solid background). */
  showCheckerboard?: boolean;
  /** Draw a procedural space starfield behind commands (replaces solid/checkerboard). */
  showSpace?: boolean;
  /**
   * When `showSpace` is set, also draw the render-db space-platform planet
   * (e.g. Nauvis) in the bottom-left. Starfield-only when omitted/false.
   */
  showSpacePlanet?: boolean;
  /**
   * Factorio planet prototype name selecting which starmap frame to draw when
   * `showSpacePlanet` is set. Falls back to `spaceBackground.planetFrame`.
   */
  spacePlanet?: string;
  /** Named entry from `RenderDb.terrainBackgrounds` (e.g. "dirt", "vulcanus"). */
  terrainBackground?: string;
  /** Draw tile grid lines and map-space coordinate labels. */
  showCoordinates?: boolean;
  /** Reuse an existing canvas instead of creating one. */
  canvas?: CanvasLike;
  /** Cancel before the destination canvas is resized or painted. */
  signal?: AbortSignal;
  /** Coarse, host-neutral render stages suitable for progress UI. */
  onProgress?: (event: RenderProgressEvent) => void;
  /**
   * When true, collect stage timings / draw-list stats onto `RenderResult.profile`.
   * Near-zero overhead when omitted/false.
   */
  profile?: boolean;
}

export interface RenderResult {
  canvas: CanvasLike;
  width: number;
  height: number;
  drawList: DrawList;
  tileFrame: TileFrame;
  /** Present when `RenderOptions.profile` was true. */
  profile?: RenderProfile;
  /** Encode the current canvas directly into the requested image format. */
  toImageBlob(options?: RenderImageOptions): Promise<Blob>;
  /** Encode the current canvas directly into a browser- or Node-compatible byte array. */
  toImageBuffer(options?: RenderImageOptions): Promise<Uint8Array>;
  toPngBlob(): Promise<Blob>;
  toPngBuffer(): Promise<Uint8Array>;
}

export interface Renderer {
  /** Plan bounds and output dimensions without loading atlases or painting. */
  measure(docOrBlueprint: BlueprintDocument | Blueprint, opts?: RenderOptions): RenderMeasurement;
  render(
    docOrBlueprint: BlueprintDocument | Blueprint,
    opts?: RenderOptions,
  ): Promise<RenderResult>;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than zero`);
  }
  return value;
}

export function measureTileFrame(
  tileFrame: TileFrame,
  requestedPixelsPerTile: number,
  maxOutputSize?: MaxOutputSize,
): RenderMeasurement {
  const requested = finitePositive(requestedPixelsPerTile, "pixelsPerTile");
  const tilesWide = Math.max(0, tileFrame.maxX - tileFrame.minX);
  const tilesHigh = Math.max(0, tileFrame.maxY - tileFrame.minY);
  const requestedWidth = Math.max(1, Math.floor(tilesWide * requested));
  const requestedHeight = Math.max(1, Math.floor(tilesHigh * requested));

  let pixelsPerTile = requested;
  if (maxOutputSize) {
    const maxWidth = finitePositive(maxOutputSize.width, "maxOutputSize.width");
    const maxHeight = finitePositive(maxOutputSize.height, "maxOutputSize.height");
    if (tilesWide > 0) pixelsPerTile = Math.min(pixelsPerTile, maxWidth / tilesWide);
    if (tilesHigh > 0) pixelsPerTile = Math.min(pixelsPerTile, maxHeight / tilesHigh);
  }

  const width = Math.max(1, Math.floor(tilesWide * pixelsPerTile));
  const height = Math.max(1, Math.floor(tilesHigh * pixelsPerTile));
  return {
    tileFrame,
    requestedPixelsPerTile: requested,
    pixelsPerTile,
    requestedWidth,
    requestedHeight,
    width,
    height,
    capped: pixelsPerTile < requested,
  };
}

function isBlueprint(value: BlueprintDocument | Blueprint): value is Blueprint {
  return (value as Blueprint).item === "blueprint";
}

/** Resolve Auto background into concrete checkerboard / space flags. */
function resolveBackgroundOpts(bp: Blueprint, opts: RenderOptions): RenderOptions {
  if (!opts.showBackgroundAuto) return opts;
  const useSpace = blueprintPrefersPlatformGraphics(bp);
  return {
    ...opts,
    showCheckerboard: !useSpace,
    showSpace: useSpace,
    showSpacePlanet: false,
    terrainBackground: undefined,
  };
}

function defaultCreateCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const el = document.createElement("canvas");
    el.width = width;
    el.height = height;
    return el as unknown as CanvasLike;
  }
  throw new Error(
    "No canvas factory available. In Node, pass createCanvas from skia-canvas " +
      "(e.g. createRenderer({ assets, createCanvas: (w, h) => new Canvas(w, h) })) " +
      "or use fpsr/node helpers.",
  );
}

async function encodeCanvasBlob(
  canvas: CanvasLike,
  options: RenderImageOptions = {},
): Promise<Blob> {
  const type = options.type ?? "image/png";
  let blob: Blob;
  if (typeof canvas.convertToBlob === "function") {
    blob = await canvas.convertToBlob({ type, quality: options.quality });
  } else {
    const htmlCanvas = canvas as unknown as HTMLCanvasElement;
    if (typeof htmlCanvas.toBlob !== "function") {
      throw new Error(
        "Canvas does not support image blob encoding; use OffscreenCanvas or HTMLCanvasElement.",
      );
    }
    blob = await new Promise<Blob>((resolve, reject) => {
      htmlCanvas.toBlob(
        (encoded) => {
          if (encoded) resolve(encoded);
          else reject(new Error("canvas.toBlob returned null"));
        },
        type,
        options.quality,
      );
    });
  }

  if (blob.type !== type) {
    throw new Error(`Canvas encoder does not support ${type}; returned ${blob.type || "unknown"}`);
  }
  return blob;
}

async function encodeCanvasBuffer(
  canvas: CanvasLike,
  options: RenderImageOptions = {},
): Promise<Uint8Array> {
  const type = options.type ?? "image/png";
  if (typeof canvas.toBuffer === "function") {
    const buffer = await canvas.toBuffer(type, { quality: options.quality });
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }
  const blob = await encodeCanvasBlob(canvas, options);
  return new Uint8Array(await blob.arrayBuffer());
}

function collectAtlasIndices(
  list: DrawList,
  db: RenderDb,
  terrainBackground?: TerrainPatchBackground,
  spacePlanetFrameId?: number,
): number[] {
  const set = new Set<number>();
  for (const cmd of list.commands) {
    if (cmd.kind === "sprite" || cmd.kind === "icon") {
      const frame = db.frames[cmd.frame];
      if (frame) set.add(frame.a);
      if (cmd.kind === "icon" && cmd.backingFrame != null) {
        const backing = db.frames[cmd.backingFrame];
        if (backing) set.add(backing.a);
      }
    }
  }
  for (const frameId of terrainBackground?.frames ?? []) {
    const frame = db.frames[frameId];
    if (frame) set.add(frame.a);
  }
  if (spacePlanetFrameId != null) {
    const frame = db.frames[spacePlanetFrameId];
    if (frame) set.add(frame.a);
  }
  return [...set].sort((a, b) => a - b);
}

function selectTerrainBackground(
  db: RenderDb,
  opts: RenderOptions,
): TerrainPatchBackground | undefined {
  if (opts.showSpace) return undefined;
  if (opts.terrainBackground == null) return undefined;
  return db.terrainBackgrounds?.[opts.terrainBackground];
}

/** Resolve the starmap frame for an optional planet prototype name. */
export function resolveSpacePlanetFrameId(
  spaceBackground: SpaceBackground | undefined,
  spacePlanet?: string,
): number | undefined {
  if (!spaceBackground) return undefined;
  if (spacePlanet != null) {
    const named = spaceBackground.planets?.[spacePlanet];
    if (named != null) return named;
  }
  return spaceBackground.planetFrame;
}

function selectSpaceBackground(db: RenderDb, opts: RenderOptions): SpaceBackground | undefined {
  if (!opts.showSpace || !opts.showSpacePlanet || !db.spaceBackground) return undefined;
  const planetFrame = resolveSpacePlanetFrameId(db.spaceBackground, opts.spacePlanet);
  if (planetFrame == null) return undefined;
  return { ...db.spaceBackground, planetFrame };
}

function summarizeDrawList(list: DrawList, atlasIndices: number[]): DrawListStats {
  const byKind: Record<string, number> = {};
  const layerHistogram: Record<string, number> = {};
  const frames = new Set<number>();
  for (const cmd of list.commands) {
    byKind[cmd.kind] = (byKind[cmd.kind] ?? 0) + 1;
    const layerKey = String(cmd.layer);
    layerHistogram[layerKey] = (layerHistogram[layerKey] ?? 0) + 1;
    if (cmd.kind === "sprite" || cmd.kind === "icon") {
      frames.add(cmd.frame);
      if (cmd.kind === "icon" && cmd.backingFrame != null) frames.add(cmd.backingFrame);
    }
  }
  return {
    commandCount: list.commands.length,
    byKind,
    uniqueFrames: frames.size,
    layerHistogram,
    atlasIndices,
  };
}

function emptyPlanProfile(): PlanProfile {
  return {
    migrateMs: 0,
    resolveMs: 0,
    tilesMs: 0,
    entitiesMs: 0,
    overlaysMs: 0,
    sortMs: 0,
    totalMs: 0,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Render aborted");
  error.name = "AbortError";
  throw error;
}

function reportProgress(opts: RenderOptions, event: RenderProgressEvent): void {
  if (!opts.signal?.aborted) opts.onProgress?.(event);
}

/**
 * Create a renderer that loads the render-db once and lazily loads atlases
 * referenced by each draw list.
 */
export async function createRenderer(options: CreateRendererOptions): Promise<Renderer> {
  const { assets } = options;
  const assetTier = options.assetTier ?? "2x";
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const db = options.renderDb ?? (await assets.loadRenderDb(assetTier));
  const atlasCache = new Map<number, Promise<CanvasImageSource>>();
  const iconImageCache = new Map<string, CanvasImageSource>();
  const silhouetteImageCache = new Map<string, CanvasImageSource>();

  const loadAtlas = (index: number): Promise<CanvasImageSource> => {
    let pending = atlasCache.get(index);
    if (!pending) {
      pending = assets.loadAtlasImage(index, assetTier).catch((error) => {
        atlasCache.delete(index);
        throw error;
      });
      atlasCache.set(index, pending);
    }
    return pending;
  };

  return {
    measure(docOrBlueprint, opts = {}): RenderMeasurement {
      throwIfAborted(opts.signal);
      const bp = isBlueprint(docOrBlueprint)
        ? docOrBlueprint
        : selectBlueprint(docOrBlueprint, opts.blueprintPath);
      const drawList = planDrawList(bp, db, {
        altMode: opts.altMode,
        background: opts.background ?? null,
      });
      throwIfAborted(opts.signal);
      const tileFrame = computeTileFrame(drawList.bounds, opts.padTiles ?? 0);
      return measureTileFrame(tileFrame, opts.pixelsPerTile ?? 64, opts.maxOutputSize);
    },

    async render(docOrBlueprint, opts = {}): Promise<RenderResult> {
      throwIfAborted(opts.signal);
      const wantProfile = opts.profile === true;
      const tTotal = wantProfile ? nowMs() : 0;
      if (wantProfile) perfMark("fpsr-render-start");

      let t = wantProfile ? nowMs() : 0;
      const bp = isBlueprint(docOrBlueprint)
        ? docOrBlueprint
        : selectBlueprint(docOrBlueprint, opts.blueprintPath);
      const selectMs = wantProfile ? nowMs() - t : 0;
      const resolvedOpts = resolveBackgroundOpts(bp, opts);

      const requestedPixelsPerTile = resolvedOpts.pixelsPerTile ?? 64;
      const padTiles = resolvedOpts.padTiles ?? 0;
      const background = resolvedOpts.background ?? null;

      const planProfile = wantProfile ? emptyPlanProfile() : undefined;
      reportProgress(resolvedOpts, { stage: "planning" });
      if (wantProfile) perfMark("fpsr-plan-start");
      const drawList = planDrawList(bp, db, {
        altMode: resolvedOpts.altMode,
        background,
        profileOut: planProfile,
      });
      throwIfAborted(resolvedOpts.signal);
      if (wantProfile) {
        perfMark("fpsr-plan-end");
        perfMeasure("fpsr-plan", "fpsr-plan-start", "fpsr-plan-end");
      }

      const terrainBackground = selectTerrainBackground(db, resolvedOpts);
      const spaceBackground = selectSpaceBackground(db, resolvedOpts);
      const atlasIndices = collectAtlasIndices(
        drawList,
        db,
        terrainBackground,
        spaceBackground?.planetFrame,
      );
      const assetEvents: AssetEvent[] = [];
      let loadedAtlasCount = 0;
      reportProgress(opts, {
        stage: "loading-assets",
        completed: loadedAtlasCount,
        total: atlasIndices.length,
      });

      if (wantProfile) perfMark("fpsr-assets-start");
      const tAssets = wantProfile ? nowMs() : 0;
      const loaded = await Promise.all(
        atlasIndices.map(async (i) => {
          const cached = atlasCache.has(i);
          const tAtlas = wantProfile ? nowMs() : 0;
          const img = await loadAtlas(i);
          loadedAtlasCount++;
          reportProgress(opts, {
            stage: "loading-assets",
            completed: loadedAtlasCount,
            total: atlasIndices.length,
          });
          if (wantProfile) {
            const atlas = db.atlases[i];
            assetEvents.push({
              kind: "atlas",
              index: i,
              tier: assetTier,
              cached,
              decodedPixels: atlas ? atlas.width * atlas.height : undefined,
              totalMs: nowMs() - tAtlas,
            });
          }
          return img;
        }),
      );
      const assetsMs = wantProfile ? nowMs() - tAssets : 0;
      throwIfAborted(opts.signal);
      if (wantProfile) {
        perfMark("fpsr-assets-end");
        perfMeasure("fpsr-assets", "fpsr-assets-start", "fpsr-assets-end");
      }

      const images: CanvasImageSource[] = [];
      for (let i = 0; i < atlasIndices.length; i++) {
        const idx = atlasIndices[i];
        const img = loaded[i];
        if (idx !== undefined && img !== undefined) {
          images[idx] = img;
        }
      }

      t = wantProfile ? nowMs() : 0;
      reportProgress(opts, { stage: "baking-icons" });
      const iconImages = new Map<number, CanvasImageSource>();
      const iconImageData = new Map<number, ImageData>();
      const silhouetteImages = new Map<number, CanvasImageSource>();
      const seenIconKeys = new Set<string>();
      const seenSilhouetteKeys = new Set<string>();
      let iconCacheHits = 0;
      let iconCacheMisses = 0;
      let silhouetteCacheHits = 0;
      let silhouetteCacheMisses = 0;
      for (const cmd of drawList.commands) {
        if (
          cmd.kind !== "icon" ||
          (cmd.backingFrame == null && cmd.backing !== true && cmd.silhouette !== true)
        ) {
          continue;
        }
        const frame = db.frames[cmd.frame];
        const atlasImage = frame ? images[frame.a] : undefined;
        if (!frame || !atlasImage || frame.w <= 0 || frame.h <= 0) continue;

        const packedWidth = frame.pw ?? frame.w;
        const packedHeight = frame.ph ?? frame.h;

        const iconKey = `${assetTier}:${cmd.frame}:${packedWidth}x${packedHeight}`;
        const cachedIcon = iconImageCache.get(iconKey);
        if (!seenIconKeys.has(iconKey)) {
          seenIconKeys.add(iconKey);
          if (cachedIcon) iconCacheHits++;
        }
        if (cachedIcon) {
          iconImages.set(cmd.frame, cachedIcon);
        } else if (!iconImages.has(cmd.frame)) {
          const iconCanvas = createCanvas(packedWidth, packedHeight);
          iconCanvas.width = packedWidth;
          iconCanvas.height = packedHeight;
          const iconContext = iconCanvas.getContext("2d");
          if (!iconContext) continue;
          iconContext.drawImage(
            atlasImage,
            frame.x,
            frame.y,
            packedWidth,
            packedHeight,
            0,
            0,
            packedWidth,
            packedHeight,
          );
          const image = iconCanvas as unknown as CanvasImageSource;
          iconImages.set(cmd.frame, image);
          iconImageCache.set(iconKey, image);
          const readableContext = iconContext as unknown as Partial<ImageDataContext>;
          if (
            cmd.backingStyle !== "request-pin" &&
            typeof readableContext.getImageData === "function"
          ) {
            iconImageData.set(
              cmd.frame,
              readableContext.getImageData(0, 0, packedWidth, packedHeight),
            );
          }
          iconCacheMisses++;
        }

        if (cmd.backingStyle === "request-pin" || silhouetteImages.has(cmd.frame)) continue;
        const densityScale = (db.assetDensity ?? 2) / 2;
        const dilateRadius = Math.max(
          1,
          Math.round(ENTITY_INFO_SILHOUETTE_RADIUS_PX * densityScale),
        );
        const blurRadius = Math.max(1, Math.round(ENTITY_INFO_SILHOUETTE_BLUR_PX * densityScale));
        const silhouetteKey = `${iconKey}:${dilateRadius}:${blurRadius}`;
        const cachedSilhouette = silhouetteImageCache.get(silhouetteKey);
        if (!seenSilhouetteKeys.has(silhouetteKey)) {
          seenSilhouetteKeys.add(silhouetteKey);
          if (cachedSilhouette) silhouetteCacheHits++;
        }
        if (cachedSilhouette) {
          silhouetteImages.set(cmd.frame, cachedSilhouette);
          continue;
        }
        const iconSource = iconImages.get(cmd.frame);
        if (!iconSource) continue;
        const sourceData = iconImageData.get(cmd.frame);
        const silhouette = sourceData
          ? bakeEntityInfoSilhouetteFromImageData(
              sourceData,
              createCanvas as (width: number, height: number) => SilhouetteCanvasLike,
              dilateRadius,
              blurRadius,
            )
          : bakeEntityInfoSilhouette(
              iconSource,
              packedWidth,
              packedHeight,
              createCanvas as (width: number, height: number) => SilhouetteCanvasLike,
              dilateRadius,
              blurRadius,
            );
        if (silhouette) {
          silhouetteImages.set(cmd.frame, silhouette);
          silhouetteImageCache.set(silhouetteKey, silhouette);
          silhouetteCacheMisses++;
        }
      }
      const iconBakeMs = wantProfile ? nowMs() - t : 0;

      t = wantProfile ? nowMs() : 0;
      const tileFrame = computeTileFrame(drawList.bounds, padTiles);
      const output = measureTileFrame(tileFrame, requestedPixelsPerTile, opts.maxOutputSize);
      const { width, height, pixelsPerTile } = output;

      throwIfAborted(opts.signal);
      const canvas = opts.canvas ?? createCanvas(width, height);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to acquire 2d canvas context");
      }
      const frameMs = wantProfile ? nowMs() - t : 0;

      if (wantProfile) perfMark("fpsr-paint-start");
      reportProgress(opts, { stage: "painting" });
      t = wantProfile ? nowMs() : 0;
      const paintStats: ExecuteDrawListStats = {
        shadowRuns: 0,
        shadowTiles: 0,
        shadowCompositedPixels: 0,
        shadowPeakScratchPixels: 0,
      };
      canvas2d.executeDrawList(ctx, drawList, images, {
        pixelsPerTile,
        padTiles,
        tileFrame,
        background,
        showCheckerboard: resolvedOpts.showCheckerboard,
        showSpace: resolvedOpts.showSpace,
        terrainBackground,
        spaceBackground,
        showCoordinates: resolvedOpts.showCoordinates,
        frames: db.frames,
        iconImages,
        silhouetteImages,
        createCanvas,
        stats: paintStats,
      });
      const paintMs = wantProfile ? nowMs() - t : 0;
      if (wantProfile) {
        perfMark("fpsr-paint-end");
        perfMeasure("fpsr-paint", "fpsr-paint-start", "fpsr-paint-end");
        perfMark("fpsr-render-end");
        perfMeasure("fpsr-render", "fpsr-render-start", "fpsr-render-end");
      }

      const profile: RenderProfile | undefined = wantProfile
        ? {
            selectMs,
            plan: planProfile ?? emptyPlanProfile(),
            assets: assetEvents,
            assetsMs,
            iconBakeMs,
            iconBakeCount: iconImages.size,
            silhouetteBakeCount: silhouetteImages.size,
            iconCacheHits,
            iconCacheMisses,
            silhouetteCacheHits,
            silhouetteCacheMisses,
            frameMs,
            paintMs,
            shadow: {
              runs: paintStats.shadowRuns,
              tiles: paintStats.shadowTiles,
              compositedPixels: paintStats.shadowCompositedPixels,
              peakScratchPixels: paintStats.shadowPeakScratchPixels,
            },
            totalMs: nowMs() - tTotal,
            cold: assetEvents.some((e) => !e.cached),
            drawList: summarizeDrawList(drawList, atlasIndices),
            output: {
              width,
              height,
              megapixels: (width * height) / 1_000_000,
              pixelsPerTile,
              requestedPixelsPerTile,
              capped: output.capped,
              assetTier,
              tileFrame,
            },
            db: {
              entityDefs: Object.keys(db.entities).length,
              tileDefs: Object.keys(db.tiles).length,
              frameCount: db.frames.length,
              atlasCount: db.atlases.length,
            },
          }
        : undefined;

      reportProgress(opts, { stage: "complete" });

      return {
        canvas,
        width,
        height,
        drawList,
        tileFrame,
        profile,
        toImageBlob(options?: RenderImageOptions): Promise<Blob> {
          return encodeCanvasBlob(canvas, options);
        },
        toImageBuffer(options?: RenderImageOptions): Promise<Uint8Array> {
          return encodeCanvasBuffer(canvas, options);
        },
        async toPngBlob(): Promise<Blob> {
          return encodeCanvasBlob(canvas, { type: "image/png" });
        },
        async toPngBuffer(): Promise<Uint8Array> {
          return encodeCanvasBuffer(canvas, { type: "image/png" });
        },
      };
    },
  };
}
