export const ASSET_VERSION = "2.1.11";

/** Vite-dev / locally served pipeline output under `assets-out/`. */
export const LOCAL_ASSETS_BASE = `/assets/${ASSET_VERSION}`;

/**
 * BunnyCDN pull zone hosting the same layout as `@fpsr/cdn-upload`
 * (`/{gameVersion}/manifest.json`, atlases, render-db).
 */
export const CDN_ASSETS_BASE = `https://fprints-data.b-cdn.net/${ASSET_VERSION}`;

export const MAX_CONCURRENT_ASSET_DECODES = 2;

export type AssetOrigin = "local" | "cdn";

export const assetsBaseFor = (origin: AssetOrigin): string => {
  return origin === "cdn" ? CDN_ASSETS_BASE : LOCAL_ASSETS_BASE;
};

/** @deprecated Prefer {@link LOCAL_ASSETS_BASE} or {@link assetsBaseFor}. */
export const ASSETS_BASE = LOCAL_ASSETS_BASE;
