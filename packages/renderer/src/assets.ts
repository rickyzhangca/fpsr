import { nowMs, type AssetEvent } from "./profile.js";
import type { RenderDb } from "./types/render-db.js";

/**
 * Pluggable atlas / render-db loader. Browser uses ImageBitmap; node uses
 * skia-canvas Image (via fpsr/node).
 */
export interface AssetSource {
  loadRenderDb(): Promise<RenderDb>;
  loadAtlasImage(index: number): Promise<CanvasImageSource>;
}

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
  decodeImage?: (blob: Blob) => Promise<CanvasImageSource>;
  fetchImpl?: typeof fetch;
  /** Maximum simultaneous bitmap decodes. Fetches remain concurrent. Default: 2. */
  maxConcurrentDecodes?: number;
  /** Optional sink for fetch/decode timing events (profiling). */
  onAssetEvent?: (event: AssetEvent) => void;
}

async function loadJson<T>(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ value: T; bytes?: number; fetchMs: number }> {
  const t0 = nowMs();
  const res = await fetchImpl(url);
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
  decodeImage?: (blob: Blob) => Promise<CanvasImageSource>,
): Promise<{ image: CanvasImageSource; decodeMs: number }> {
  const t0 = nowMs();
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(blob);
    return { image, decodeMs: nowMs() - t0 };
  }
  if (decodeImage) {
    const image = await decodeImage(blob);
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
 *   {baseUrl}/{manifest.renderDb.file}
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
  let dbPromise: Promise<RenderDb> | undefined;
  let dbReady = false;
  const atlasCache = new Map<number, Promise<CanvasImageSource>>();
  const atlasReady = new Set<number>();

  const loadManifest = (): Promise<AssetManifest> => {
    if (!manifestPromise) {
      const url = `${root}/manifest.json`;
      manifestPromise = (async () => {
        const t0 = nowMs();
        const { value, bytes, fetchMs } = await loadJson<AssetManifest>(url, fetchImpl);
        if (value.schema !== 2) {
          throw new Error(`Unsupported asset manifest schema: ${String(value.schema)}`);
        }
        if (!value.renderDb?.file) {
          throw new Error("Asset manifest is missing renderDb.file");
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

  return {
    loadRenderDb(): Promise<RenderDb> {
      if (!dbPromise) {
        dbPromise = (async () => {
          const t0 = nowMs();
          const manifest = await loadManifest();
          const url = `${root}/${manifest.renderDb.file}`;
          const { value, bytes, fetchMs } = await loadJson<RenderDb>(url, fetchImpl);
          if (value.schema !== 2) {
            throw new Error(`Unsupported render-db schema: ${String(value.schema)}`);
          }
          onAssetEvent?.({
            kind: "render-db",
            url,
            cached: false,
            fetchMs,
            totalMs: nowMs() - t0,
            bytes,
          });
          dbReady = true;
          return value;
        })().catch((error) => {
          dbPromise = undefined;
          dbReady = false;
          throw error;
        });
      } else if (dbReady) {
        onAssetEvent?.({
          kind: "render-db",
          url: undefined,
          cached: true,
          totalMs: 0,
        });
      }
      return dbPromise;
    },

    async loadAtlasImage(index: number): Promise<CanvasImageSource> {
      let pending = atlasCache.get(index);
      if (!pending) {
        pending = (async () => {
          const t0 = nowMs();
          const manifest = await loadManifest();
          const entry = manifest.atlases[index];
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
            url,
            cached: false,
            fetchMs,
            queueMs,
            decodeMs,
            decodedPixels: entry.w * entry.h,
            totalMs: nowMs() - t0,
            bytes: blob.size,
          });
          atlasReady.add(index);
          return image;
        })().catch((error) => {
          atlasCache.delete(index);
          atlasReady.delete(index);
          throw error;
        });
        atlasCache.set(index, pending);
      } else if (atlasReady.has(index)) {
        onAssetEvent?.({
          kind: "atlas",
          index,
          cached: true,
          totalMs: 0,
        });
      }
      return pending;
    },
  };
}
