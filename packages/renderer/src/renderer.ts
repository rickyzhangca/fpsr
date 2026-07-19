import { raceWithAbort, throwIfAborted as throwIfSignalAborted } from "./abort.js";
import type { AssetSource, AssetTier } from "./assets.js";
import {
  AssetDensityMismatchError,
  resolveBackground,
  UnknownTerrainBackgroundError,
  type RenderBackground,
} from "./background.js";
import { selectBlueprint, selectDeconstructionPlanner, selectUpgradePlanner } from "./book.js";
import type { Canvas2DContextLike, ExecuteDrawListStats } from "./canvas2d.js";
import * as canvas2d from "./canvas2d.js";
import { computeTileFrame, type TileFrame } from "./frame.js";
import type { ImageDataLike, ImageSource } from "./host.js";
import {
  bakeEntityInfoSilhouette,
  bakeEntityInfoSilhouetteFromImageData,
  ENTITY_INFO_SILHOUETTE_BLUR_PX,
  ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  type ImageDataContext,
  type SilhouetteCanvasLike,
} from "./icon-silhouette.js";
import { planDrawListInternal } from "./plan.js";
import { planDeconstructionPlannerDrawList } from "./plan/deconstruction-planner.js";
import { planUpgradePlannerDrawList } from "./plan/upgrade-planner.js";
import { createStreamingPngEncoder } from "./png-stream.js";
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
import { drawListForTile } from "./tiled-draw-list.js";
import type { Blueprint, BlueprintDocument } from "./types/blueprint.js";
import type { DrawList } from "./types/draw-list.js";
import type { RenderDb, SpaceBackground, TerrainPatchBackground } from "./types/render-db.js";

export { AssetDensityMismatchError, UnknownTerrainBackgroundError } from "./background.js";
export type { RenderBackground } from "./background.js";

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
  | { stage: "painting-tiles"; completed: number; total: number }
  | { stage: "encoding" }
  | { stage: "complete" };

/**
 * Layout-only options for {@link Renderer.measure}.
 * Honored fields affect planned bounds / output size; paint-only options are omitted.
 */
export interface MeasureOptions {
  blueprintPath?: number[];
  pixelsPerTile?: number;
  maxOutputSize?: MaxOutputSize;
  padTiles?: number;
  altMode?: boolean;
  beltEndings?: boolean;
  signal?: AbortSignal;
}

/** Public render options (no prepared-viewport / tiled internals). */
export interface RenderOptions {
  blueprintPath?: number[];
  pixelsPerTile?: number;
  /**
   * Fit the output inside this box by lowering pixelsPerTile before painting.
   * The renderer never creates a full-resolution intermediate canvas.
   */
  maxOutputSize?: MaxOutputSize;
  altMode?: boolean;
  beltEndings?: boolean;
  /** Discriminated background mode. Defaults to `{ type: "none" }`. */
  background?: RenderBackground;
  padTiles?: number;
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
   * Near-zero overhead when omitted/false. Ignored by {@link Renderer.renderTiledPng}.
   */
  profile?: boolean;
}

/**
 * Internal prepared-viewport paint options used by the viewer tiled preview and
 * the tiled PNG exporter. Not part of the stable public `render()` contract —
 * see `internal/prepared-viewport.ts`.
 */
export interface PreparedViewportRenderOptions extends RenderOptions {
  /** Advanced: render only this tile-aligned viewport. */
  tileFrame: TileFrame;
  /** Full frame containing `tileFrame`, used to anchor global backgrounds. */
  outputTileFrame: TileFrame;
  /** Prepared draw list (already clipped) to avoid replanning each tile. */
  preparedDrawList: DrawList;
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
  measure(docOrBlueprint: BlueprintDocument | Blueprint, opts?: MeasureOptions): RenderMeasurement;
  render(
    docOrBlueprint: BlueprintDocument | Blueprint,
    opts?: RenderOptions,
  ): Promise<RenderResult>;
  /** Render a full-resolution PNG with bounded raw-pixel working memory. */
  renderTiledPng(
    docOrBlueprint: BlueprintDocument | Blueprint,
    opts?: TiledPngOptions,
  ): Promise<TiledPngResult>;
  /**
   * Release renderer-owned derived caches (icon crops / silhouettes).
   * Does **not** dispose the caller-supplied {@link AssetSource} or close
   * atlas `ImageSource` objects owned by that source.
   */
  dispose(): void;
}

export interface TiledPngOptions extends Omit<
  RenderOptions,
  "canvas" | "maxOutputSize" | "profile" | "onProgress"
> {
  /** Target maximum edge of each temporary canvas. Defaults to 2048 px. */
  tileSize?: number;
  /** Maximum assembled raw strip memory. Defaults to 32 MiB. */
  maxStripeBytes?: number;
  signal?: AbortSignal;
  onProgress?: (event: RenderProgressEvent) => void;
}

export interface TiledPngResult {
  blob: Blob;
  width: number;
  height: number;
  tileFrame: TileFrame;
  tiled: true;
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

function trySelectUpgradePlanner(
  doc: BlueprintDocument,
  path: number[] | undefined,
): Record<string, unknown> | null {
  try {
    return selectUpgradePlanner(doc, path);
  } catch {
    return null;
  }
}

function trySelectDeconstructionPlanner(
  doc: BlueprintDocument,
  path: number[] | undefined,
): Record<string, unknown> | null {
  try {
    return selectDeconstructionPlanner(doc, path);
  } catch {
    return null;
  }
}

/** Resolve Auto background into concrete checkerboard / space flags. */
function resolveBackgroundOpts(
  bp: Blueprint | null,
  background: RenderBackground | undefined,
): ReturnType<typeof resolveBackground> {
  return resolveBackground(bp ? blueprintPrefersPlatformGraphics(bp) : false, background);
}

function planDocumentDrawList(
  docOrBlueprint: BlueprintDocument | Blueprint,
  db: RenderDb,
  opts: {
    blueprintPath?: number[];
    altMode?: boolean;
    beltEndings?: boolean;
    profileOut?: PlanProfile;
  },
): {
  drawList: DrawList;
  blueprint: Blueprint | null;
} {
  if (isBlueprint(docOrBlueprint)) {
    return {
      blueprint: docOrBlueprint,
      drawList: planDrawListInternal(docOrBlueprint, db, {
        altMode: opts.altMode,
        beltEndings: opts.beltEndings,
        profileOut: opts.profileOut,
      }).drawList,
    };
  }

  const planner = trySelectUpgradePlanner(docOrBlueprint, opts.blueprintPath);
  if (planner) {
    return {
      blueprint: null,
      drawList: planUpgradePlannerDrawList(planner, db),
    };
  }

  const deconstruction = trySelectDeconstructionPlanner(docOrBlueprint, opts.blueprintPath);
  if (deconstruction) {
    return {
      blueprint: null,
      drawList: planDeconstructionPlannerDrawList(deconstruction, db),
    };
  }

  const blueprint = selectBlueprint(docOrBlueprint, opts.blueprintPath);
  return {
    blueprint,
    drawList: planDrawListInternal(blueprint, db, {
      altMode: opts.altMode,
      beltEndings: opts.beltEndings,
      profileOut: opts.profileOut,
    }).drawList,
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
    const htmlCanvas = canvas as unknown as {
      toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
    };
    if (typeof htmlCanvas.toBlob !== "function") {
      throw new Error(
        "Canvas does not support image blob encoding; use OffscreenCanvas or HTMLCanvasElement.",
      );
    }
    blob = await new Promise<Blob>((resolve, reject) => {
      htmlCanvas.toBlob!(
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
  for (const patch of terrainBackground?.patches ?? []) {
    for (const frameId of patch.frames) {
      const frame = db.frames[frameId];
      if (frame) set.add(frame.a);
    }
  }
  if (spacePlanetFrameId != null) {
    const frame = db.frames[spacePlanetFrameId];
    if (frame) set.add(frame.a);
  }
  return [...set].sort((a, b) => a - b);
}

function selectTerrainBackground(
  db: RenderDb,
  terrainName: string | undefined,
): TerrainPatchBackground | undefined {
  if (terrainName == null) return undefined;
  const background = db.terrainBackgrounds?.[terrainName];
  if (!background) {
    throw new UnknownTerrainBackgroundError(terrainName);
  }
  return background;
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

function selectSpaceBackground(
  db: RenderDb,
  resolved: ReturnType<typeof resolveBackground>,
): SpaceBackground | undefined {
  if (!resolved.showSpace || !resolved.showSpacePlanet || !db.spaceBackground) return undefined;
  const planetFrame = resolveSpacePlanetFrameId(db.spaceBackground, resolved.spacePlanet);
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
  throwIfSignalAborted(signal, "Render aborted");
}

/**
 * Internal registry so tiled/viewer hosts can paint prepared viewports without
 * exposing that method on the stable {@link Renderer} type.
 */
const preparedViewportByRenderer = new WeakMap<
  Renderer,
  (
    docOrBlueprint: BlueprintDocument | Blueprint,
    opts: PreparedViewportRenderOptions,
  ) => Promise<RenderResult>
>();

/** @internal Used by `internal/prepared-viewport.ts` only. */
export function getPreparedViewportHandler(
  renderer: Renderer,
):
  | ((
      docOrBlueprint: BlueprintDocument | Blueprint,
      opts: PreparedViewportRenderOptions,
    ) => Promise<RenderResult>)
  | undefined {
  return preparedViewportByRenderer.get(renderer);
}

function reportProgress(
  opts: { signal?: AbortSignal; onProgress?: (event: RenderProgressEvent) => void },
  event: RenderProgressEvent,
): void {
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
  const expectedDensity = assetTier === "1x" ? 1 : 2;
  if (db.assetDensity != null && db.assetDensity !== expectedDensity) {
    throw new AssetDensityMismatchError(assetTier, expectedDensity, db.assetDensity);
  }
  await assets.ensureFonts?.();
  const atlasCache = new Map<number, Promise<ImageSource>>();
  const iconImageCache = new Map<string, ImageSource>();
  const silhouetteImageCache = new Map<string, ImageSource>();

  /**
   * Cache only signal-independent shared atlas promises. Per-caller abort is
   * applied via {@link raceWithAbort} so concurrent renders are not coupled.
   */
  const loadAtlas = (index: number, signal?: AbortSignal): Promise<ImageSource> => {
    let pending = atlasCache.get(index);
    if (!pending) {
      pending = assets.loadAtlasImage(index, assetTier).catch((error) => {
        atlasCache.delete(index);
        throw error;
      });
      atlasCache.set(index, pending);
    }
    return raceWithAbort(pending, signal);
  };

  /** Shared paint path for both a fresh plan (`render`) and a prepared viewport. */
  async function paint(
    docOrBlueprint: BlueprintDocument | Blueprint,
    opts: RenderOptions & Partial<PreparedViewportRenderOptions>,
  ): Promise<RenderResult> {
    throwIfAborted(opts.signal);
    const wantProfile = opts.profile === true;
    const tTotal = wantProfile ? nowMs() : 0;
    if (wantProfile) perfMark("fpsr-render-start");

    let t = wantProfile ? nowMs() : 0;
    const planProfile = wantProfile ? emptyPlanProfile() : undefined;
    reportProgress(opts, { stage: "planning" });
    if (wantProfile) perfMark("fpsr-plan-start");

    let bp: Blueprint | null;
    let drawList: DrawList;
    if (opts.preparedDrawList !== undefined) {
      drawList = opts.preparedDrawList;
      if (isBlueprint(docOrBlueprint)) {
        bp = docOrBlueprint;
      } else {
        try {
          bp = selectBlueprint(docOrBlueprint, opts.blueprintPath);
        } catch {
          bp = null;
        }
      }
    } else {
      const planned = planDocumentDrawList(docOrBlueprint, db, {
        blueprintPath: opts.blueprintPath,
        altMode: opts.altMode,
        beltEndings: opts.beltEndings,
        profileOut: planProfile,
      });
      bp = planned.blueprint;
      drawList = planned.drawList;
    }
    const selectMs = wantProfile ? nowMs() - t : 0;
    const bg = resolveBackgroundOpts(bp, opts.background);

    const requestedPixelsPerTile = opts.pixelsPerTile ?? 64;
    const padTiles = opts.padTiles ?? 0;

    throwIfAborted(opts.signal);
    if (wantProfile) {
      perfMark("fpsr-plan-end");
      perfMeasure("fpsr-plan", "fpsr-plan-start", "fpsr-plan-end");
    }

    const terrainBackground = selectTerrainBackground(db, bg.terrainName);
    const spaceBackground = selectSpaceBackground(db, bg);
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
        const img = await loadAtlas(i, opts.signal);
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

    const images: ImageSource[] = [];
    for (let i = 0; i < atlasIndices.length; i++) {
      const idx = atlasIndices[i];
      const img = loaded[i];
      if (idx !== undefined && img !== undefined) {
        images[idx] = img;
      }
    }

    t = wantProfile ? nowMs() : 0;
    reportProgress(opts, { stage: "baking-icons" });
    const iconImages = new Map<number, ImageSource>();
    const iconImageData = new Map<number, ImageDataLike>();
    const silhouetteImages = new Map<number, ImageSource>();
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
        const image = iconCanvas as unknown as ImageSource;
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
      const dilateRadius = Math.max(1, Math.round(ENTITY_INFO_SILHOUETTE_RADIUS_PX * densityScale));
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
    const outputTileFrame = opts.outputTileFrame ?? computeTileFrame(drawList.bounds, padTiles);
    const tileFrame = opts.tileFrame ?? outputTileFrame;
    if (
      tileFrame.minX < outputTileFrame.minX ||
      tileFrame.minY < outputTileFrame.minY ||
      tileFrame.maxX > outputTileFrame.maxX ||
      tileFrame.maxY > outputTileFrame.maxY ||
      tileFrame.minX >= tileFrame.maxX ||
      tileFrame.minY >= tileFrame.maxY
    ) {
      throw new Error("tileFrame must be a non-empty viewport inside outputTileFrame");
    }
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
    const paintList = opts.tileFrame ? drawListForTile(drawList, db.frames, tileFrame) : drawList;
    canvas2d.executeDrawList(ctx, paintList, images, {
      pixelsPerTile,
      padTiles,
      tileFrame,
      outputTileFrame,
      background: bg.solid,
      showCheckerboard: bg.showCheckerboard,
      showSpace: bg.showSpace,
      terrainBackground,
      spaceBackground,
      showCoordinates: opts.showCoordinates,
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
  }

  const renderer: Renderer = {
    measure(docOrBlueprint, opts = {}): RenderMeasurement {
      throwIfAborted(opts.signal);
      const { drawList } = planDocumentDrawList(docOrBlueprint, db, {
        blueprintPath: opts.blueprintPath,
        altMode: opts.altMode,
        beltEndings: opts.beltEndings,
      });
      throwIfAborted(opts.signal);
      const tileFrame = computeTileFrame(drawList.bounds, opts.padTiles ?? 0);
      return measureTileFrame(tileFrame, opts.pixelsPerTile ?? 64, opts.maxOutputSize);
    },

    render(docOrBlueprint, opts = {}): Promise<RenderResult> {
      return paint(docOrBlueprint, opts);
    },

    async renderTiledPng(docOrBlueprint, opts = {}): Promise<TiledPngResult> {
      throwIfAborted(opts.signal);
      const pixelsPerTile = opts.pixelsPerTile ?? 64;
      if (!Number.isInteger(pixelsPerTile) || pixelsPerTile <= 0) {
        throw new Error("Tiled PNG export requires an integer pixelsPerTile greater than zero");
      }
      reportProgress(opts, { stage: "planning" });
      const { drawList: preparedDrawList } = planDocumentDrawList(docOrBlueprint, db, {
        blueprintPath: opts.blueprintPath,
        altMode: opts.altMode,
        beltEndings: opts.beltEndings,
      });
      const padTiles = opts.padTiles ?? 0;
      const tileFrame = computeTileFrame(preparedDrawList.bounds, padTiles);
      const { width, height } = measureTileFrame(tileFrame, pixelsPerTile);
      const tileSize = Math.max(pixelsPerTile, Math.floor(opts.tileSize ?? 2048));
      const maxPaintTileEdge = Math.max(1, Math.floor(tileSize / pixelsPerTile));
      const viewportBleedTiles = Math.min(2, Math.max(0, Math.floor((maxPaintTileEdge - 1) / 2)));
      const chunkTileWidth = Math.max(1, maxPaintTileEdge - viewportBleedTiles * 2);
      const maxStripeBytes = Math.max(
        width * pixelsPerTile * 4,
        opts.maxStripeBytes ?? 32 * 1024 * 1024,
      );
      const maxStripePixelRows = Math.max(
        pixelsPerTile,
        Math.floor(maxStripeBytes / Math.max(1, width * 4) / pixelsPerTile) * pixelsPerTile,
      );
      const stripTileHeight = Math.max(
        1,
        Math.min(chunkTileWidth, Math.floor(maxStripePixelRows / pixelsPerTile)),
      );
      const tileColumns = Math.ceil((tileFrame.maxX - tileFrame.minX) / chunkTileWidth);
      const tileRows = Math.ceil((tileFrame.maxY - tileFrame.minY) / stripTileHeight);
      const totalTiles = tileColumns * tileRows;
      const encoder = createStreamingPngEncoder(width, height);
      let completedTiles = 0;

      const { tileSize: _tileSize, maxStripeBytes: _maxStripeBytes, ...renderOpts } = opts;

      for (let minY = tileFrame.minY; minY < tileFrame.maxY; minY += stripTileHeight) {
        throwIfAborted(opts.signal);
        const maxY = Math.min(tileFrame.maxY, minY + stripTileHeight);
        const stripHeight = (maxY - minY) * pixelsPerTile;
        const strip = new Uint8Array(width * stripHeight * 4);

        for (let minX = tileFrame.minX; minX < tileFrame.maxX; minX += chunkTileWidth) {
          throwIfAborted(opts.signal);
          const maxX = Math.min(tileFrame.maxX, minX + chunkTileWidth);
          const paintRegion: TileFrame = {
            minX: Math.max(tileFrame.minX, minX - viewportBleedTiles),
            minY: Math.max(tileFrame.minY, minY - viewportBleedTiles),
            maxX: Math.min(tileFrame.maxX, maxX + viewportBleedTiles),
            maxY: Math.min(tileFrame.maxY, maxY + viewportBleedTiles),
          };
          const regionDrawList = drawListForTile(preparedDrawList, db.frames, paintRegion);
          const rendered = await paint(docOrBlueprint, {
            ...renderOpts,
            pixelsPerTile,
            profile: false,
            tileFrame: paintRegion,
            outputTileFrame: tileFrame,
            preparedDrawList: regionDrawList,
            onProgress: undefined,
          });
          const context = rendered.canvas.getContext("2d") as
            | (Canvas2DContextLike & {
                getImageData(x: number, y: number, width: number, height: number): ImageDataLike;
              })
            | null;
          if (!context || typeof context.getImageData !== "function") {
            throw new Error("Tiled PNG export requires Canvas2D getImageData support");
          }
          const sourceX = (minX - paintRegion.minX) * pixelsPerTile;
          const sourceY = (minY - paintRegion.minY) * pixelsPerTile;
          const regionWidth = (maxX - minX) * pixelsPerTile;
          const regionHeight = (maxY - minY) * pixelsPerTile;
          const pixels = context.getImageData(sourceX, sourceY, regionWidth, regionHeight).data;
          const destinationX = (minX - tileFrame.minX) * pixelsPerTile;
          for (let row = 0; row < regionHeight; row++) {
            const sourceStart = row * regionWidth * 4;
            const destinationStart = (row * width + destinationX) * 4;
            strip.set(
              pixels.subarray(sourceStart, sourceStart + regionWidth * 4),
              destinationStart,
            );
          }
          completedTiles++;
          reportProgress(opts, {
            stage: "painting-tiles",
            completed: completedTiles,
            total: totalTiles,
          });
        }
        encoder.writeRgbaRows(strip, stripHeight);
      }

      reportProgress(opts, { stage: "encoding" });
      const blob = encoder.finish();
      reportProgress(opts, { stage: "complete" });
      return { blob, width, height, tileFrame, tiled: true };
    },

    dispose(): void {
      // Only renderer-owned derived surfaces. Atlas ImageSources and the
      // caller-supplied AssetSource remain owned by the asset host.
      iconImageCache.clear();
      silhouetteImageCache.clear();
      atlasCache.clear();
    },
  };

  preparedViewportByRenderer.set(renderer, (docOrBlueprint, opts) => paint(docOrBlueprint, opts));

  return renderer;
}
