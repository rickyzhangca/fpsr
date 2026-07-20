import { cdnAssets, type AssetSource } from "@rickyzhangca/fpsr";
import {
  assetsBaseFor,
  cdnDebugFetchFor,
  defaultUseCdnAssets,
  MAX_CONCURRENT_ASSET_DECODES,
  type AssetOrigin,
} from "./asset-config";

const createSource = (baseUrl: string): AssetSource => {
  const fetchImpl = cdnDebugFetchFor(baseUrl);
  return cdnAssets(baseUrl, {
    ...(fetchImpl ? { fetchImpl } : {}),
    maxConcurrentDecodes: MAX_CONCURRENT_ASSET_DECODES,
  });
};

/** Production boots on CDN; local/jsdom keep `/assets` (Vite or tests). */
const initialOrigin: AssetOrigin = defaultUseCdnAssets() ? "cdn" : "local";
let origin: AssetOrigin = initialOrigin;
let source = createSource(assetsBaseFor(initialOrigin));
let generation = 0;
const listeners = new Set<(next: AssetOrigin) => void>();

/**
 * Shared UI-thread asset source. Methods always forward to the active origin so
 * callers can keep a stable import while the CDN/local switch recreates the
 * underlying `cdnAssets` instance.
 */
export const viewerAssets: AssetSource = {
  loadRenderDb(tier, options) {
    return source.loadRenderDb(tier, options);
  },
  loadAtlasImage(index, tier, options) {
    return source.loadAtlasImage(index, tier, options);
  },
  dispose() {
    source.dispose?.();
  },
};

export const getViewerAssetOrigin = (): AssetOrigin => origin;

export const getViewerAssetOriginGeneration = (): number => generation;

/** Notify when CDN/local origin switches (e.g. FactorioItemIcon reload). */
export const subscribeViewerAssetOrigin = (listener: (next: AssetOrigin) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setViewerAssetOrigin = (next: AssetOrigin): void => {
  if (next === origin) return;
  source.dispose?.();
  origin = next;
  source = createSource(assetsBaseFor(next));
  generation += 1;
  for (const listener of listeners) listener(origin);
};
