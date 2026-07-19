import { cdnAssets, type AssetSource } from "fpsr";
import {
  assetsBaseFor,
  LOCAL_ASSETS_BASE,
  MAX_CONCURRENT_ASSET_DECODES,
  type AssetOrigin,
} from "./asset-config";

const createSource = (baseUrl: string): AssetSource =>
  cdnAssets(baseUrl, {
    maxConcurrentDecodes: MAX_CONCURRENT_ASSET_DECODES,
  });

let origin: AssetOrigin = "local";
let source = createSource(LOCAL_ASSETS_BASE);

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

export const setViewerAssetOrigin = (next: AssetOrigin): void => {
  if (next === origin) return;
  source.dispose?.();
  origin = next;
  source = createSource(assetsBaseFor(next));
};
