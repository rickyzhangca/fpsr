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
  gameVersion: string;
  atlases: ManifestAtlas[];
  renderDbSha256?: string;
}

export interface CdnAssetsOptions {
  /**
   * Decode an atlas blob when `createImageBitmap` is unavailable (e.g. Node 22
   * with fetch but no ImageBitmap). Required for node consumers of cdnAssets;
   * browser builds ignore this when createImageBitmap exists.
   */
  decodeImage?: (blob: Blob) => Promise<CanvasImageSource>;
  fetchImpl?: typeof fetch;
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
  const text = await res.text();
  const fetchMs = nowMs() - t0;
  const bytes = text.length;
  return { value: JSON.parse(text) as T, bytes, fetchMs };
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
 *   {baseUrl}/render-db.json
 *   {baseUrl}/manifest.json
 *   {baseUrl}/{atlas.file}
 */
export function cdnAssets(baseUrl: string, options?: CdnAssetsOptions): AssetSource {
  const root = baseUrl.replace(/\/+$/, "");
  const fetchImpl = options?.fetchImpl ?? fetch;
  const onAssetEvent = options?.onAssetEvent;
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
      })();
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
        const url = `${root}/render-db.json`;
        dbPromise = (async () => {
          const t0 = nowMs();
          const { value, bytes, fetchMs } = await loadJson<RenderDb>(url, fetchImpl);
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
        })();
      } else if (dbReady) {
        onAssetEvent?.({
          kind: "render-db",
          url: `${root}/render-db.json`,
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
          const { image, decodeMs } = await blobToImage(blob, options?.decodeImage);
          onAssetEvent?.({
            kind: "atlas",
            index,
            url,
            cached: false,
            fetchMs,
            decodeMs,
            totalMs: nowMs() - t0,
            bytes: blob.size,
          });
          atlasReady.add(index);
          return image;
        })();
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
