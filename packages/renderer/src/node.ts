/**
 * Node-only asset helpers. Import from "@rickyzhangca/fpsr/node", not from the main entry.
 *
 * Requires the optional peer dependency `skia-canvas` for Image decoding.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { raceWithAbort, throwIfAborted } from "./abort.js";
import type { AssetManifest, AssetSource, AssetTier } from "./assets.js";
import type { AssetLoadOptions, ImageSource } from "./host.js";
import type { RenderDb } from "./types/render-db.js";

type SkiaLoadImage = (src: string | Uint8Array) => Promise<ImageSource>;

async function loadSkiaLoadImage(): Promise<SkiaLoadImage> {
  try {
    const mod = (await import("skia-canvas")) as unknown as {
      loadImage: SkiaLoadImage;
    };
    return mod.loadImage;
  } catch {
    throw new Error(
      'fpsr/node localAssets() requires the peer dependency "skia-canvas". ' +
        "Install it with: pnpm add skia-canvas",
    );
  }
}

/**
 * Filesystem AssetSource for a pipeline output directory
 * (manifest.json + content-addressed render-db/atlas files).
 *
 * AbortSignal rejects only the waiting caller; shared in-flight loads continue
 * for other consumers. Rejected loads are cleared from the cache so a later
 * call can retry (including abort-driven waiter rejection of a still-pending
 * shared promise, which does not clear the shared slot).
 */
export function localAssets(dir: string): AssetSource {
  const root = path.resolve(dir);
  const dbPromises = new Map<AssetTier, Promise<RenderDb>>();
  let manifestPromise: Promise<AssetManifest> | undefined;
  const atlasCache = new Map<string, Promise<ImageSource>>();
  let fontsPromise: Promise<void> | undefined;

  const readJson = async <T>(file: string): Promise<T> => {
    const text = await readFile(path.join(root, file), "utf8");
    return JSON.parse(text) as T;
  };

  const loadManifest = (): Promise<AssetManifest> => {
    if (!manifestPromise) {
      manifestPromise = readJson<AssetManifest>("manifest.json").catch((error) => {
        manifestPromise = undefined;
        throw error;
      });
    }
    return manifestPromise;
  };

  return {
    loadRenderDb(tier: AssetTier = "2x", options?: AssetLoadOptions): Promise<RenderDb> {
      throwIfAborted(options?.signal);
      let pending = dbPromises.get(tier);
      if (!pending) {
        pending = loadManifest()
          .then(async (manifest) => {
            if (manifest.schema !== 2) {
              throw new Error(`Unsupported asset manifest schema: ${String(manifest.schema)}`);
            }
            const db = await readJson<RenderDb>(manifest.tiers[tier].renderDb.file);
            if (db.schema !== 2) {
              throw new Error(`Unsupported render-db schema: ${String(db.schema)}`);
            }
            return db;
          })
          .catch((error) => {
            dbPromises.delete(tier);
            throw error;
          });
        dbPromises.set(tier, pending);
      }
      return raceWithAbort(pending, options?.signal);
    },

    loadAtlasImage(
      index: number,
      tier: AssetTier = "2x",
      options?: AssetLoadOptions,
    ): Promise<ImageSource> {
      throwIfAborted(options?.signal);
      const cacheKey = `${tier}:${index}`;
      let pending = atlasCache.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          const manifest = await loadManifest();
          const entry = manifest.tiers[tier].atlases[index];
          if (!entry) {
            throw new Error(`Atlas index ${index} missing from manifest at ${root}`);
          }
          const loadImage = await loadSkiaLoadImage();
          return loadImage(path.join(root, entry.file));
        })().catch((error) => {
          atlasCache.delete(cacheKey);
          throw error;
        });
        atlasCache.set(cacheKey, pending);
      }
      return raceWithAbort(pending, options?.signal);
    },

    ensureFonts(options?: AssetLoadOptions): Promise<void> {
      throwIfAborted(options?.signal);
      if (!fontsPromise) {
        fontsPromise = (async () => {
          try {
            const manifest = await loadManifest();
            const fonts = manifest.fonts ?? [];
            if (fonts.length === 0) return;
            const skia = (await import("skia-canvas")) as unknown as {
              FontLibrary: { use: (alias: string, paths: string | string[]) => unknown };
            };
            for (const font of fonts) {
              skia.FontLibrary.use(font.family, path.join(root, font.file));
            }
          } catch {
            // Font registration is best-effort; canvas falls back to system fonts.
          }
        })();
      }
      return raceWithAbort(fontsPromise, options?.signal);
    },

    dispose(): void {
      atlasCache.clear();
      dbPromises.clear();
      manifestPromise = undefined;
      fontsPromise = undefined;
    },
  };
}
