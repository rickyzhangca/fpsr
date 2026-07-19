import { raceWithAbort, throwIfAborted } from "./abort.js";
import type { AssetLoadOptions, ImageSource } from "./host.js";
import { nowMs, type AssetEvent } from "./profile.js";
import type { RenderDb } from "./types/render-db.js";

/**
 * Pluggable atlas / render-db loader. Browser uses ImageBitmap; node uses
 * skia-canvas Image (via fpsr/node).
 *
 * ## AbortSignal semantics
 *
 * `loadRenderDb` / `loadAtlasImage` accept an optional `signal` on the load
 * options. Aborting rejects **only the waiting caller** with an `AbortError`.
 * Shared in-flight network/decode work is **not** cancelled for other
 * concurrent consumers of the same cache key. Aborted waits never write into
 * or delete a successful cache entry; only genuine load failures clear the
 * shared promise slot so a later call can retry.
 */
export interface AssetSource {
  loadRenderDb(tier?: AssetTier, options?: AssetLoadOptions): Promise<RenderDb>;
  loadAtlasImage(index: number, tier?: AssetTier, options?: AssetLoadOptions): Promise<ImageSource>;
  /**
   * Optional: release retained decoded images / clear caches.
   * Ownership stays with the AssetSource caller — Renderer.dispose never invokes this.
   */
  dispose?(): void;
}

export type AssetTier = "1x" | "2x";

export interface ManifestAtlas {
  file: string;
  w: number;
  h: number;
  sha256?: string;
}

export interface AssetManifest {
  schema: 2;
  gameVersion: string;
  mods: string[];
  tiers: Record<AssetTier, AssetTierManifest>;
}

export interface AssetTierManifest {
  density: 1 | 2;
  atlases: ManifestAtlas[];
  renderDb: {
    file: string;
    sha256: string;
    bytes?: number;
  };
}

export interface CdnAssetsOptions {
  /**
   * Decode an atlas blob when `createImageBitmap` is unavailable (e.g. Node 22
   * with fetch but no ImageBitmap). Required for node consumers of cdnAssets;
   * browser builds ignore this when createImageBitmap exists.
   */
  decodeImage?: (blob: Blob, signal?: AbortSignal) => Promise<ImageSource>;
  fetchImpl?: typeof fetch;
  /** Maximum simultaneous bitmap decodes. Fetches remain concurrent. Default: 2. */
  maxConcurrentDecodes?: number;
  /** Optional sink for fetch/decode timing events (profiling). */
  onAssetEvent?: (event: AssetEvent) => void;
}

async function loadJson<T>(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ value: T; bytes?: number; fetchMs: number }> {
  const t0 = nowMs();
  const res = await fetchImpl(url, signal ? { signal } : undefined);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const body = await res.arrayBuffer();
  const fetchMs = nowMs() - t0;
  const text = new TextDecoder().decode(body);
  return { value: JSON.parse(text) as T, bytes: body.byteLength, fetchMs };
}

function decodeLimiter(
  limit: number,
): <T>(task: () => Promise<T>) => Promise<{ value: T; queueMs: number }> {
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiting.push(() => {
        active++;
        resolve();
      });
    });
  };

  const release = (): void => {
    active--;
    waiting.shift()?.();
  };

  return async <T>(task: () => Promise<T>) => {
    const queuedAt = nowMs();
    await acquire();
    const queueMs = nowMs() - queuedAt;
    try {
      return { value: await task(), queueMs };
    } finally {
      release();
    }
  };
}

async function blobToImage(
  blob: Blob,
  decodeImage?: (blob: Blob, signal?: AbortSignal) => Promise<ImageSource>,
  signal?: AbortSignal,
): Promise<{ image: ImageSource; decodeMs: number }> {
  throwIfAborted(signal);
  const t0 = nowMs();
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(blob);
    throwIfAborted(signal);
    return { image: image as ImageSource, decodeMs: nowMs() - t0 };
  }
  if (decodeImage) {
    const image = await decodeImage(blob, signal);
    throwIfAborted(signal);
    return { image, decodeMs: nowMs() - t0 };
  }
  throw new Error(
    "createImageBitmap is unavailable; pass cdnAssets(baseUrl, { decodeImage }) " +
      "or use localAssets from fpsr/node",
  );
}

/**
 * Fetch-based AssetSource for CDN (or any HTTP) layouts:
 *   {baseUrl}/manifest.json
 *   {baseUrl}/{manifest.tiers[tier].renderDb.file}
 *   {baseUrl}/{atlas.file}
 */
export function cdnAssets(baseUrl: string, options?: CdnAssetsOptions): AssetSource {
  const root = baseUrl.replace(/\/+$/, "");
  const fetchImpl = options?.fetchImpl ?? fetch;
  const onAssetEvent = options?.onAssetEvent;
  const maxConcurrentDecodes = Math.max(1, Math.floor(options?.maxConcurrentDecodes ?? 2));
  const withDecodeSlot = decodeLimiter(maxConcurrentDecodes);
  let manifestPromise: Promise<AssetManifest> | undefined;
  let manifestReady = false;
  const dbPromises = new Map<AssetTier, Promise<RenderDb>>();
  const dbReady = new Set<AssetTier>();
  const atlasCache = new Map<string, Promise<ImageSource>>();
  const atlasReady = new Set<string>();

  /**
   * Shared loads intentionally omit AbortSignal so one cancelled waiter does
   * not cancel the underlying fetch for other consumers. Waiters race via
   * {@link raceWithAbort}.
   */
  const loadManifest = (): Promise<AssetManifest> => {
    if (!manifestPromise) {
      const url = `${root}/manifest.json`;
      manifestPromise = (async () => {
        const t0 = nowMs();
        const { value, bytes, fetchMs } = await loadJson<AssetManifest>(url, fetchImpl);
        if (value.schema !== 2) {
          throw new Error(`Unsupported asset manifest schema: ${String(value.schema)}`);
        }
        if (!value.tiers?.["1x"]?.renderDb.file || !value.tiers?.["2x"]?.renderDb.file) {
          throw new Error("Asset manifest is missing required 1x/2x tiers");
        }
        onAssetEvent?.({
          kind: "manifest",
          url,
          cached: false,
          fetchMs,
          totalMs: nowMs() - t0,
          bytes,
        });
        manifestReady = true;
        return value;
      })().catch((error) => {
        manifestPromise = undefined;
        manifestReady = false;
        throw error;
      });
    } else if (manifestReady) {
      onAssetEvent?.({
        kind: "manifest",
        url: `${root}/manifest.json`,
        cached: true,
        totalMs: 0,
      });
    }
    return manifestPromise;
  };

  const source: AssetSource = {
    loadRenderDb(tier: AssetTier = "2x", loadOptions?: AssetLoadOptions): Promise<RenderDb> {
      throwIfAborted(loadOptions?.signal);
      let pending = dbPromises.get(tier);
      if (!pending) {
        pending = (async () => {
          const t0 = nowMs();
          const manifest = await loadManifest();
          const url = `${root}/${manifest.tiers[tier].renderDb.file}`;
          const { value, bytes, fetchMs } = await loadJson<RenderDb>(url, fetchImpl);
          if (value.schema !== 2) {
            throw new Error(`Unsupported render-db schema: ${String(value.schema)}`);
          }
          onAssetEvent?.({
            kind: "render-db",
            tier,
            url,
            cached: false,
            fetchMs,
            totalMs: nowMs() - t0,
            bytes,
          });
          dbReady.add(tier);
          return value;
        })().catch((error) => {
          dbPromises.delete(tier);
          dbReady.delete(tier);
          throw error;
        });
        dbPromises.set(tier, pending);
      } else if (dbReady.has(tier)) {
        onAssetEvent?.({
          kind: "render-db",
          tier,
          url: undefined,
          cached: true,
          totalMs: 0,
        });
      }
      return raceWithAbort(pending, loadOptions?.signal);
    },

    loadAtlasImage(
      index: number,
      tier: AssetTier = "2x",
      loadOptions?: AssetLoadOptions,
    ): Promise<ImageSource> {
      throwIfAborted(loadOptions?.signal);
      const cacheKey = `${tier}:${index}`;
      let pending = atlasCache.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          const t0 = nowMs();
          const manifest = await loadManifest();
          const entry = manifest.tiers[tier].atlases[index];
          if (!entry) {
            throw new Error(`Atlas index ${index} missing from manifest`);
          }
          const url = `${root}/${entry.file}`;
          const tFetch = nowMs();
          const res = await fetchImpl(url);
          if (!res.ok) {
            throw new Error(`Failed to fetch atlas ${url}: ${res.status}`);
          }
          const blob = await res.blob();
          const fetchMs = nowMs() - tFetch;
          const { value: decoded, queueMs } = await withDecodeSlot(() =>
            blobToImage(blob, options?.decodeImage),
          );
          const { image, decodeMs } = decoded;
          onAssetEvent?.({
            kind: "atlas",
            index,
            tier,
            url,
            cached: false,
            fetchMs,
            queueMs,
            decodeMs,
            decodedPixels: entry.w * entry.h,
            totalMs: nowMs() - t0,
            bytes: blob.size,
          });
          atlasReady.add(cacheKey);
          return image;
        })().catch((error) => {
          atlasCache.delete(cacheKey);
          atlasReady.delete(cacheKey);
          throw error;
        });
        atlasCache.set(cacheKey, pending);
      } else if (atlasReady.has(cacheKey)) {
        onAssetEvent?.({
          kind: "atlas",
          index,
          tier,
          cached: true,
          totalMs: 0,
        });
      }
      return raceWithAbort(pending, loadOptions?.signal);
    },

    dispose(): void {
      for (const pending of atlasCache.values()) {
        void pending.then((image) => {
          const maybeBitmap = image as { close?: () => void };
          maybeBitmap.close?.();
        });
      }
      atlasCache.clear();
      atlasReady.clear();
      dbPromises.clear();
      dbReady.clear();
      manifestPromise = undefined;
      manifestReady = false;
    },
  };

  return source;
}
