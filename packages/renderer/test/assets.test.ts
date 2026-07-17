import { describe, expect, it, vi } from "vite-plus/test";
import { cdnAssets, type AssetManifest } from "../src/assets.js";
import type { RenderDb } from "../src/types/render-db.js";

const db: RenderDb = {
  schema: 2,
  gameVersion: "2.1.11",
  mods: ["base"],
  atlases: [
    { file: "atlas.a.png", width: 10, height: 20 },
    { file: "atlas.b.png", width: 30, height: 40 },
    { file: "atlas.c.png", width: 50, height: 60 },
  ],
  frames: [],
  entities: {},
  tiles: {},
  icons: {},
};

const manifest: AssetManifest = {
  schema: 2,
  gameVersion: "2.1.11",
  mods: ["base"],
  tiers: {
    "1x": {
      density: 1,
      renderDb: { file: "render-db.1x.hash.json", sha256: "1x-hash" },
      atlases: db.atlases.map((atlas) => ({
        file: `1x-${atlas.file}`,
        w: Math.ceil(atlas.width / 2),
        h: Math.ceil(atlas.height / 2),
      })),
    },
    "2x": {
      density: 2,
      renderDb: { file: "render-db.2x.hash.json", sha256: "2x-hash" },
      atlases: db.atlases.map((atlas) => ({
        file: atlas.file,
        w: atlas.width,
        h: atlas.height,
      })),
    },
  },
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

describe("cdnAssets", () => {
  it("loads schema-2 content-addressed render databases", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("manifest.json")) return jsonResponse(manifest);
      if (url.endsWith(manifest.tiers["2x"].renderDb.file)) return jsonResponse(db);
      return new Response(null, { status: 404 });
    });

    const assets = cdnAssets("https://assets.example/2.1.11", { fetchImpl });
    const loaded = await assets.loadRenderDb();
    expect(loaded).toEqual(db);
    await expect(assets.loadRenderDb()).resolves.toBe(loaded);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps 1x and 2x databases and atlases in independent caches", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("manifest.json")) return jsonResponse(manifest);
      if (url.includes("render-db.")) return jsonResponse(db);
      return new Response(new Blob([url]), { status: 200 });
    });
    const decodeImage = vi.fn<(blob: Blob) => Promise<CanvasImageSource>>(
      async () => ({}) as CanvasImageSource,
    );
    const assets = cdnAssets("https://assets.example/2.1.11", { fetchImpl, decodeImage });

    await Promise.all([
      assets.loadRenderDb("1x"),
      assets.loadRenderDb("2x"),
      assets.loadAtlasImage(0, "1x"),
      assets.loadAtlasImage(0, "2x"),
    ]);

    expect(decodeImage).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("deduplicates atlas promises and limits bitmap decoding to two slots", async () => {
    let active = 0;
    let maxActive = 0;
    const events: import("../src/profile.js").AssetEvent[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("manifest.json")) return jsonResponse(manifest);
      return new Response(new Blob([url]), { status: 200 });
    });
    const decodeImage = vi.fn<(blob: Blob) => Promise<CanvasImageSource>>(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return {} as CanvasImageSource;
    });
    const assets = cdnAssets("https://assets.example/2.1.11", {
      fetchImpl,
      decodeImage,
      maxConcurrentDecodes: 2,
      onAssetEvent: (event) => events.push(event),
    });

    const first = assets.loadAtlasImage(0);
    const duplicate = assets.loadAtlasImage(0);
    await Promise.all([first, duplicate, assets.loadAtlasImage(1), assets.loadAtlasImage(2)]);

    expect(maxActive).toBe(2);
    expect(decodeImage).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(events.find((event) => event.index === 1)?.decodedPixels).toBe(1_200);
    expect(events.find((event) => event.index === 2)?.queueMs).toBeGreaterThanOrEqual(0);
  });

  it("evicts failed atlas promises so a later request can retry", async () => {
    let atlasAttempts = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith("manifest.json")) return jsonResponse(manifest);
      atlasAttempts++;
      if (atlasAttempts === 1) return new Response(null, { status: 503 });
      return new Response(new Blob(["ok"]), { status: 200 });
    });
    const assets = cdnAssets("https://assets.example/2.1.11", {
      fetchImpl,
      decodeImage: async () => ({}) as CanvasImageSource,
    });

    await expect(assets.loadAtlasImage(0)).rejects.toThrow("503");
    await expect(assets.loadAtlasImage(0)).resolves.toBeTruthy();
    expect(atlasAttempts).toBe(2);
  });
});
