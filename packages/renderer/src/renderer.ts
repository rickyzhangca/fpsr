import type { AssetSource } from "./assets.js";
import { selectBlueprint } from "./book.js";
import type { Canvas2DContextLike, ExecuteDrawListStats } from "./canvas2d.js";
import * as canvas2d from "./canvas2d.js";
import { computeTileFrame, type TileFrame } from "./frame.js";
import {
  bakeEntityInfoSilhouette,
  ENTITY_INFO_SILHOUETTE_BLUR_PX,
  ENTITY_INFO_SILHOUETTE_RADIUS_PX,
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
import type { Blueprint, BlueprintDocument } from "./types/blueprint.js";
import type { DrawList } from "./types/draw-list.js";
import type { RenderDb } from "./types/render-db.js";

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): Canvas2DContextLike | null;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
  toBuffer?(mime?: string): Buffer | Promise<Buffer>;
}

export type CreateCanvasFn = (width: number, height: number) => CanvasLike;

export interface CreateRendererOptions {
  assets: AssetSource;
  /** Preloaded render-db; when omitted, loaded once via assets.loadRenderDb(). */
  renderDb?: RenderDb;
  /** Canvas factory; defaults to OffscreenCanvas / document.createElement. */
  createCanvas?: CreateCanvasFn;
}

export interface RenderOptions {
  blueprintPath?: number[];
  pixelsPerTile?: number;
  altMode?: boolean;
  background?: [number, number, number, number] | null;
  padTiles?: number;
  /** Draw tile-aligned checkerboard behind commands (replaces solid background). */
  showCheckerboard?: boolean;
  /** Draw tile grid lines and map-space coordinate labels. */
  showCoordinates?: boolean;
  /** Reuse an existing canvas instead of creating one. */
  canvas?: CanvasLike;
  /** Cancel before the destination canvas is resized or painted. */
  signal?: AbortSignal;
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
  toPngBlob(): Promise<Blob>;
  toPngBuffer(): Promise<Uint8Array>;
}

export interface Renderer {
  render(
    docOrBlueprint: BlueprintDocument | Blueprint,
    opts?: RenderOptions,
  ): Promise<RenderResult>;
}

function isBlueprint(value: BlueprintDocument | Blueprint): value is Blueprint {
  return (value as Blueprint).item === "blueprint";
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

function collectAtlasIndices(list: DrawList, db: RenderDb): number[] {
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
  return [...set].sort((a, b) => a - b);
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

/**
 * Create a renderer that loads the render-db once and lazily loads atlases
 * referenced by each draw list.
 */
export async function createRenderer(options: CreateRendererOptions): Promise<Renderer> {
  const { assets } = options;
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const db = options.renderDb ?? (await assets.loadRenderDb());
  const atlasCache = new Map<number, Promise<CanvasImageSource>>();
  const iconImageCache = new Map<string, CanvasImageSource>();
  const silhouetteImageCache = new Map<string, CanvasImageSource>();

  const loadAtlas = (index: number): Promise<CanvasImageSource> => {
    let pending = atlasCache.get(index);
    if (!pending) {
      pending = assets.loadAtlasImage(index).catch((error) => {
        atlasCache.delete(index);
        throw error;
      });
      atlasCache.set(index, pending);
    }
    return pending;
  };

  return {
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

      const pixelsPerTile = opts.pixelsPerTile ?? 64;
      const padTiles = opts.padTiles ?? 0;
      const background = opts.background ?? null;

      const planProfile = wantProfile ? emptyPlanProfile() : undefined;
      if (wantProfile) perfMark("fpsr-plan-start");
      const drawList = planDrawList(bp, db, {
        altMode: opts.altMode,
        background,
        profileOut: planProfile,
      });
      throwIfAborted(opts.signal);
      if (wantProfile) {
        perfMark("fpsr-plan-end");
        perfMeasure("fpsr-plan", "fpsr-plan-start", "fpsr-plan-end");
      }

      const atlasIndices = collectAtlasIndices(drawList, db);
      const assetEvents: AssetEvent[] = [];

      if (wantProfile) perfMark("fpsr-assets-start");
      const tAssets = wantProfile ? nowMs() : 0;
      const loaded = await Promise.all(
        atlasIndices.map(async (i) => {
          const cached = atlasCache.has(i);
          const tAtlas = wantProfile ? nowMs() : 0;
          const img = await loadAtlas(i);
          if (wantProfile) {
            const atlas = db.atlases[i];
            assetEvents.push({
              kind: "atlas",
              index: i,
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
      const iconImages = new Map<number, CanvasImageSource>();
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

        const iconKey = `${cmd.frame}:${frame.w}x${frame.h}`;
        const cachedIcon = iconImageCache.get(iconKey);
        if (!seenIconKeys.has(iconKey)) {
          seenIconKeys.add(iconKey);
          if (cachedIcon) iconCacheHits++;
        }
        if (cachedIcon) {
          iconImages.set(cmd.frame, cachedIcon);
        } else if (!iconImages.has(cmd.frame)) {
          const iconCanvas = createCanvas(frame.w, frame.h);
          iconCanvas.width = frame.w;
          iconCanvas.height = frame.h;
          const iconContext = iconCanvas.getContext("2d");
          if (!iconContext) continue;
          iconContext.drawImage(
            atlasImage,
            frame.x,
            frame.y,
            frame.w,
            frame.h,
            0,
            0,
            frame.w,
            frame.h,
          );
          const image = iconCanvas as unknown as CanvasImageSource;
          iconImages.set(cmd.frame, image);
          iconImageCache.set(iconKey, image);
          iconCacheMisses++;
        }

        if (cmd.backingStyle === "request-pin" || silhouetteImages.has(cmd.frame)) continue;
        const silhouetteKey = `${iconKey}:${ENTITY_INFO_SILHOUETTE_RADIUS_PX}:${ENTITY_INFO_SILHOUETTE_BLUR_PX}`;
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
        const silhouette = bakeEntityInfoSilhouette(
          iconSource,
          frame.w,
          frame.h,
          createCanvas as (width: number, height: number) => SilhouetteCanvasLike,
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
      const width = Math.max(1, (tileFrame.maxX - tileFrame.minX) * pixelsPerTile);
      const height = Math.max(1, (tileFrame.maxY - tileFrame.minY) * pixelsPerTile);

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
        showCheckerboard: opts.showCheckerboard,
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

      return {
        canvas,
        width,
        height,
        drawList,
        tileFrame,
        profile,
        async toPngBlob(): Promise<Blob> {
          if (typeof canvas.convertToBlob === "function") {
            return canvas.convertToBlob({ type: "image/png" });
          }
          const htmlCanvas = canvas as unknown as HTMLCanvasElement;
          if (typeof htmlCanvas.toBlob === "function") {
            return new Promise<Blob>((resolve, reject) => {
              htmlCanvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("canvas.toBlob returned null"));
              }, "image/png");
            });
          }
          throw new Error(
            "Canvas does not support toPngBlob(); use OffscreenCanvas, HTMLCanvasElement, " +
              "or skia-canvas with toPngBuffer()",
          );
        },
        async toPngBuffer(): Promise<Uint8Array> {
          if (typeof canvas.toBuffer === "function") {
            const buf = await canvas.toBuffer("image/png");
            return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
          }
          // Fall back via blob when available.
          if (
            typeof canvas.convertToBlob === "function" ||
            typeof (canvas as unknown as HTMLCanvasElement).toBlob === "function"
          ) {
            const blob = await (async () => {
              if (typeof canvas.convertToBlob === "function") {
                return canvas.convertToBlob({ type: "image/png" });
              }
              const htmlCanvas = canvas as unknown as HTMLCanvasElement;
              return new Promise<Blob>((resolve, reject) => {
                htmlCanvas.toBlob((b) => {
                  if (b) resolve(b);
                  else reject(new Error("canvas.toBlob returned null"));
                }, "image/png");
              });
            })();
            const ab = await blob.arrayBuffer();
            return new Uint8Array(ab);
          }
          throw new Error(
            "Canvas does not support toPngBuffer(); in Node pass a skia-canvas Canvas " +
              "via createCanvas / render({ canvas })",
          );
        },
      };
    },
  };
}
