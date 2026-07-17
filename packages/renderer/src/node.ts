/**
 * Node-only asset helpers. Import from "fpsr/node", not from the main entry.
 *
 * Requires the optional peer dependency `skia-canvas` for Image decoding.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AssetManifest, AssetSource, AssetTier } from "./assets.js";
import type { RenderDb } from "./types/render-db.js";

type SkiaLoadImage = (src: string | Uint8Array) => Promise<CanvasImageSource>;

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
 */
export function localAssets(dir: string): AssetSource {
  const root = path.resolve(dir);
  const dbPromises = new Map<AssetTier, Promise<RenderDb>>();
  let manifestPromise: Promise<AssetManifest> | undefined;
  const atlasCache = new Map<string, Promise<CanvasImageSource>>();

  const readJson = async <T>(file: string): Promise<T> => {
    const text = await readFile(path.join(root, file), "utf8");
    return JSON.parse(text) as T;
  };

  const loadManifest = (): Promise<AssetManifest> => {
    if (!manifestPromise) {
      manifestPromise = readJson<AssetManifest>("manifest.json");
    }
    return manifestPromise;
  };

  return {
    loadRenderDb(tier: AssetTier = "2x"): Promise<RenderDb> {
      let pending = dbPromises.get(tier);
      if (!pending) {
        pending = loadManifest().then(async (manifest) => {
          if (manifest.schema !== 2) {
            throw new Error(`Unsupported asset manifest schema: ${String(manifest.schema)}`);
          }
          const db = await readJson<RenderDb>(manifest.tiers[tier].renderDb.file);
          if (db.schema !== 2) {
            throw new Error(`Unsupported render-db schema: ${String(db.schema)}`);
          }
          return db;
        });
        dbPromises.set(tier, pending);
      }
      return pending;
    },

    async loadAtlasImage(index: number, tier: AssetTier = "2x"): Promise<CanvasImageSource> {
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
        })();
        atlasCache.set(cacheKey, pending);
      }
      return pending;
    },
  };
}
