export const ASSET_VERSION = "2.1.11";

const LOCAL_ASSET_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Local `/assets` is only served by the Vite dev middleware from `assets-out/`.
 * Deployed hosts must load atlases and the render DB from BunnyCDN.
 */
export const canUseLocalAssets = (): boolean => {
  if (typeof window === "undefined") return false;
  const { hostname } = window.location;
  // jsdom and other test environments often leave hostname empty.
  if (hostname === "") return true;
  return LOCAL_ASSET_HOSTNAMES.has(hostname);
};

/** Default preview preference: CDN everywhere except local dev. */
export const defaultUseCdnAssets = (): boolean => !canUseLocalAssets();

/** Vite-dev / locally served pipeline output under `assets-out/`. */
export const LOCAL_ASSETS_BASE = `/assets/${ASSET_VERSION}`;

/**
 * BunnyCDN pull zone hosting the same layout as `@fpsr/cdn-upload`
 * (`/{gameVersion}/manifest.json`, atlases, render-db).
 */
export const CDN_ASSETS_BASE = `https://fpsr.b-cdn.net/${ASSET_VERSION}`;

const CDN_DEBUG_TOKEN_KEYS = new Set(["expires", "token", "token_path"]);

/**
 * Return a fetch implementation that adds a short-lived Bunny directory token
 * to CDN requests during Vite development. The signing key never reaches the
 * browser; only the generated token query belongs in `.env.local`.
 */
export const cdnDebugFetchFor = (baseUrl: string): typeof fetch | undefined => {
  if (!import.meta.env.DEV || baseUrl !== CDN_ASSETS_BASE) return undefined;

  const rawQuery = import.meta.env.VITE_FPSR_CDN_TOKEN_QUERY?.trim().replace(/^\?/, "");
  if (!rawQuery) return undefined;

  const tokenQuery = new URLSearchParams(rawQuery);
  const keys = [...tokenQuery.keys()];
  const expectedPath = `/${ASSET_VERSION}/`;
  if (
    keys.some((key) => !CDN_DEBUG_TOKEN_KEYS.has(key)) ||
    !tokenQuery.get("token")?.startsWith("HS256-") ||
    !/^\d+$/.test(tokenQuery.get("expires") ?? "") ||
    tokenQuery.get("token_path") !== expectedPath
  ) {
    throw new Error(
      `Invalid VITE_FPSR_CDN_TOKEN_QUERY; expected an HS256 directory token for ${expectedPath}`,
    );
  }

  return (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestUrl);
    if (url.origin === new URL(CDN_ASSETS_BASE).origin && url.pathname.startsWith(expectedPath)) {
      tokenQuery.forEach((value, key) => url.searchParams.set(key, value));
    }

    if (request) return fetch(new Request(url, request), init);
    return fetch(url, init);
  };
};

export const MAX_CONCURRENT_ASSET_DECODES = 2;

export type AssetOrigin = "local" | "cdn";

export const assetsBaseFor = (origin: AssetOrigin): string => {
  return origin === "cdn" ? CDN_ASSETS_BASE : LOCAL_ASSETS_BASE;
};

/** @deprecated Prefer {@link LOCAL_ASSETS_BASE} or {@link assetsBaseFor}. */
export const ASSETS_BASE = LOCAL_ASSETS_BASE;
