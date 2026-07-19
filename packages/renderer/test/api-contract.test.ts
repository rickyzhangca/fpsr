import { describe, expect, it } from "vite-plus/test";
import {
  AssetDensityMismatchError,
  UnknownTerrainBackgroundError,
  createRenderer,
  type CanvasLike,
} from "../src/renderer.js";
import type { AssetSource } from "../src/assets.js";
import type { ImageSource } from "../src/host.js";
import type { RenderDb } from "../src/types/render-db.js";

function stubDb(assetDensity?: 1 | 2): RenderDb {
  return {
    schema: 2,
    gameVersion: "2.1.11",
    mods: ["base"],
    ...(assetDensity != null ? { assetDensity } : {}),
    atlases: [],
    frames: [],
    entities: {},
    tiles: {},
    icons: {},
  };
}

function stubAssets(db: RenderDb): AssetSource {
  return {
    async loadRenderDb() {
      return db;
    },
    async loadAtlasImage(): Promise<ImageSource> {
      return {};
    },
  };
}

function stubCanvas(width: number, height: number): CanvasLike {
  return {
    width,
    height,
    getContext() {
      return null;
    },
  };
}

describe("createRenderer contract", () => {
  it("throws AssetDensityMismatchError when render-db density disagrees with tier", async () => {
    await expect(
      createRenderer({
        assets: stubAssets(stubDb(1)),
        assetTier: "2x",
        createCanvas: stubCanvas,
      }),
    ).rejects.toBeInstanceOf(AssetDensityMismatchError);
  });

  it("accepts matching density and exposes dispose", async () => {
    const renderer = await createRenderer({
      assets: stubAssets(stubDb(2)),
      assetTier: "2x",
      createCanvas: stubCanvas,
    });
    expect(typeof renderer.dispose).toBe("function");
    renderer.dispose();
  });

  it("rejects unknown terrain backgrounds instead of painting transparent", async () => {
    const renderer = await createRenderer({
      assets: stubAssets(stubDb(2)),
      createCanvas: stubCanvas,
    });
    const bp = { item: "blueprint" as const, version: 2 * 2 ** 48, entities: [] };
    await expect(
      renderer.render(bp, { background: { type: "terrain", name: "not-a-real-terrain" } }),
    ).rejects.toBeInstanceOf(UnknownTerrainBackgroundError);
  });
});
