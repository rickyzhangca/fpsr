import { describe, expect, it, vi } from "vite-plus/test";
import type { AssetSource } from "../src/assets.js";
import type { Canvas2DContextLike } from "../src/canvas2d.js";
import * as canvas2d from "../src/canvas2d.js";
import type { CanvasLike, RenderProgressEvent } from "../src/renderer.js";
import { createRenderer, measureTileFrame, resolveSpacePlanetFrameId } from "../src/renderer.js";
import type { Blueprint, BlueprintDocument } from "../src/types/blueprint.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

describe("resolveSpacePlanetFrameId", () => {
  it("returns the named planet frame when present", () => {
    const spaceBackground = {
      planetFrame: 0,
      planets: { nauvis: 0, vulcanus: 2 },
    };
    expect(resolveSpacePlanetFrameId(spaceBackground)).toBe(0);
    expect(resolveSpacePlanetFrameId(spaceBackground, "nauvis")).toBe(0);
    expect(resolveSpacePlanetFrameId(spaceBackground, "vulcanus")).toBe(2);
    expect(resolveSpacePlanetFrameId(spaceBackground, "missing")).toBe(0);
    expect(resolveSpacePlanetFrameId(undefined, "nauvis")).toBeUndefined();
  });
});

function stubCtx(): Canvas2DContextLike {
  return {
    save() {},
    restore() {},
    scale() {},
    rotate() {},
    translate() {},
    fillRect() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    stroke() {},
    fill() {},
    rect() {},
    clip() {},
    drawImage() {},
    fillText() {},
    set fillStyle(_v: string | CanvasGradient | CanvasPattern) {},
    set strokeStyle(_v: string | CanvasGradient | CanvasPattern) {},
    set lineWidth(_v: number) {},
    set lineCap(_v: CanvasLineCap) {},
    set globalAlpha(_v: number) {},
    get globalAlpha() {
      return 1;
    },
    set globalCompositeOperation(_v: GlobalCompositeOperation) {},
    get globalCompositeOperation(): GlobalCompositeOperation {
      return "source-over";
    },
    set filter(_v: string) {},
    set font(_v: string) {},
    set textBaseline(_v: CanvasTextBaseline) {},
    set textAlign(_v: CanvasTextAlign) {},
    set imageSmoothingEnabled(_v: boolean) {},
  };
}

function stubCanvas(): CanvasLike {
  return {
    width: 0,
    height: 0,
    getContext() {
      return stubCtx();
    },
  };
}

function imageDataCanvas(): CanvasLike {
  const canvas = stubCanvas();
  const base = canvas.getContext("2d")!;
  return {
    ...canvas,
    getContext() {
      return Object.assign(base, {
        getImageData(_x: number, _y: number, width: number, height: number) {
          return {
            data: new Uint8ClampedArray(width * height * 4),
            width,
            height,
            colorSpace: "srgb",
          } as ImageData;
        },
        putImageData() {},
      });
    },
  };
}

describe("createRenderer", () => {
  const db = makeMiniDb();
  const fakeImage = { id: "atlas-0" } as unknown as CanvasImageSource;

  const assets: AssetSource = {
    async loadRenderDb() {
      return db;
    },
    async loadAtlasImage() {
      return fakeImage;
    },
  };

  it("fits output inside a maximum size without changing the tile frame", () => {
    const measured = measureTileFrame({ minX: 0, minY: 0, maxX: 89, maxY: 151 }, 64, {
      width: 4096,
      height: 4096,
    });

    expect(measured.requestedWidth).toBe(5696);
    expect(measured.requestedHeight).toBe(9664);
    expect(measured.width).toBe(2414);
    expect(measured.height).toBe(4096);
    expect(measured.pixelsPerTile).toBeCloseTo(4096 / 151);
    expect(measured.capped).toBe(true);
  });

  it("measures without loading atlases or mutating a canvas", async () => {
    const loadAtlasImage = vi.fn<() => Promise<CanvasImageSource>>(async () => fakeImage);
    const createCanvas = vi.fn<() => CanvasLike>(() => stubCanvas());
    const renderer = await createRenderer({
      assets: { ...assets, loadAtlasImage },
      renderDb: db,
      createCanvas,
    });
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };

    const measured = renderer.measure(bp, {
      pixelsPerTile: 64,
      padTiles: 1,
      maxOutputSize: { width: 32, height: 32 },
    });

    expect(measured.width).toBeLessThanOrEqual(32);
    expect(measured.height).toBeLessThanOrEqual(32);
    expect(loadAtlasImage).not.toHaveBeenCalled();
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("render() returns drawList and calls executeDrawList", async () => {
    const spy = vi.spyOn(canvas2d, "executeDrawList");
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    const out = await renderer.render(bp, { pixelsPerTile: 32, padTiles: 1 });
    expect(out.drawList.commands.length).toBeGreaterThan(0);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    expect(out.profile).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("encodes WebP directly from the rendered canvas with the requested quality", async () => {
    const convertToBlob = vi.fn<(options?: { type?: string; quality?: number }) => Promise<Blob>>(
      async (options?: { type?: string; quality?: number }) =>
        new Blob(["encoded"], { type: options?.type }),
    );
    const toBuffer = vi.fn<(mime?: string, options?: { quality?: number }) => Promise<Uint8Array>>(
      async () => Buffer.from("encoded"),
    );
    const canvas = { ...stubCanvas(), convertToBlob, toBuffer };
    const renderer = await createRenderer({ assets, renderDb: db, createCanvas: () => canvas });
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };

    const result = await renderer.render(bp);
    const blob = await result.toImageBlob({ type: "image/webp", quality: 0.9 });

    expect(blob.type).toBe("image/webp");
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/webp", quality: 0.9 });
    expect(await result.toImageBuffer({ type: "image/webp", quality: 0.9 })).toEqual(
      Buffer.from("encoded"),
    );
    expect(toBuffer).toHaveBeenCalledWith("image/webp", { quality: 0.9 });
  });

  it("rejects an unsupported image encoder fallback instead of mislabeling the file", async () => {
    const canvas = {
      ...stubCanvas(),
      async convertToBlob() {
        return new Blob(["png"], { type: "image/png" });
      },
    };
    const renderer = await createRenderer({ assets, renderDb: db, createCanvas: () => canvas });
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };

    const result = await renderer.render(bp);
    await expect(result.toImageBlob({ type: "image/webp" })).rejects.toThrow(
      "Canvas encoder does not support image/webp",
    );
  });

  it("profile:true attaches RenderProfile with stage timings and counts", async () => {
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    const cold = await renderer.render(bp, { pixelsPerTile: 32, padTiles: 1, profile: true });
    expect(cold.profile).toBeDefined();
    const p = cold.profile!;
    expect(p.drawList.commandCount).toBe(cold.drawList.commands.length);
    expect(p.plan.totalMs).toBeGreaterThanOrEqual(0);
    expect(p.paintMs).toBeGreaterThanOrEqual(0);
    expect(p.assetsMs).toBeGreaterThanOrEqual(0);
    expect(p.totalMs).toBeGreaterThanOrEqual(p.paintMs);
    expect(p.shadow.peakScratchPixels).toBeGreaterThanOrEqual(0);
    expect(p.output.width).toBe(cold.width);
    expect(p.output.requestedPixelsPerTile).toBe(32);
    expect(p.output.capped).toBe(false);
    expect(p.cold).toBe(true);
    expect(p.assets.some((a) => a.kind === "atlas" && !a.cached)).toBe(true);

    const warm = await renderer.render(bp, { pixelsPerTile: 32, padTiles: 1, profile: true });
    expect(warm.profile?.cold).toBe(false);
    expect(warm.profile?.assets.every((a) => a.cached)).toBe(true);
  });

  it("reports coarse progress and completed atlas loads", async () => {
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });
    const progress: RenderProgressEvent[] = [];
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    await renderer.render(bp, { onProgress: (event) => progress.push(event) });

    expect(progress[0]).toEqual({ stage: "planning" });
    expect(progress).toContainEqual({ stage: "loading-assets", completed: 0, total: 1 });
    expect(progress).toContainEqual({ stage: "loading-assets", completed: 1, total: 1 });
    expect(progress.map((event) => event.stage)).toContain("baking-icons");
    expect(progress.map((event) => event.stage)).toContain("painting");
    expect(progress.at(-1)).toEqual({ stage: "complete" });
  });

  it("forwards showCoordinates to executeDrawList", async () => {
    const spy = vi.spyOn(canvas2d, "executeDrawList");
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    await renderer.render(bp, { pixelsPerTile: 32, showCoordinates: true });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ showCoordinates: true }),
    );
    spy.mockRestore();
  });

  it("forwards showCheckerboard to executeDrawList", async () => {
    const spy = vi.spyOn(canvas2d, "executeDrawList");
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    await renderer.render(bp, { pixelsPerTile: 32, showCheckerboard: true });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ showCheckerboard: true }),
    );
    spy.mockRestore();
  });

  it("resolves showBackgroundAuto to checkerboard for normal blueprints", async () => {
    const spy = vi.spyOn(canvas2d, "executeDrawList");
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    await renderer.render(bp, { pixelsPerTile: 32, showBackgroundAuto: true });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        showCheckerboard: true,
        showSpace: false,
        terrainBackground: undefined,
      }),
    );
    spy.mockRestore();
  });

  it("resolves showBackgroundAuto to space for space-platform blueprints", async () => {
    const spy = vi.spyOn(canvas2d, "executeDrawList");
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "space-platform-hub",
          position: { x: 0.5, y: 0.5 },
        },
      ],
      tiles: [{ name: "space-platform-foundation", position: { x: 0, y: 0 } }],
    };

    await renderer.render(bp, { pixelsPerTile: 32, showBackgroundAuto: true });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        showCheckerboard: false,
        showSpace: true,
        terrainBackground: undefined,
        spaceBackground: undefined,
      }),
    );
    spy.mockRestore();
  });

  it("forwards showSpace to executeDrawList", async () => {
    const spy = vi.spyOn(canvas2d, "executeDrawList");
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    await renderer.render(bp, { pixelsPerTile: 32, showSpace: true });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        showSpace: true,
        spaceBackground: undefined,
      }),
    );

    await renderer.render(bp, {
      pixelsPerTile: 32,
      showSpace: true,
      showSpacePlanet: true,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        showSpace: true,
        spaceBackground: expect.objectContaining({
          planetFrame: db.spaceBackground?.planetFrame,
          planets: db.spaceBackground?.planets,
        }),
      }),
    );

    await renderer.render(bp, {
      pixelsPerTile: 32,
      showSpace: true,
      showSpacePlanet: true,
      spacePlanet: "vulcanus",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        showSpace: true,
        spaceBackground: expect.objectContaining({
          planetFrame: db.spaceBackground?.planets?.vulcanus,
        }),
      }),
    );
    spy.mockRestore();
  });

  it("forwards terrainBackground to executeDrawList", async () => {
    const spy = vi.spyOn(canvas2d, "executeDrawList");
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    };

    await renderer.render(bp, { pixelsPerTile: 32, terrainBackground: "dirt" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        terrainBackground: db.terrainBackgrounds?.dirt,
      }),
    );

    await renderer.render(bp, { pixelsPerTile: 32, terrainBackground: "water" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        terrainBackground: db.terrainBackgrounds?.water,
      }),
    );

    await renderer.render(bp, { pixelsPerTile: 32, terrainBackground: "vulcanus" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        terrainBackground: db.terrainBackgrounds?.vulcanus,
      }),
    );
    spy.mockRestore();
  });

  it("loads only the selected terrain mode's atlas pages", async () => {
    const terrainDb = structuredClone(makeMiniDb());
    terrainDb.atlases.push(
      { file: "atlas-dirt.png", width: 256, height: 256 },
      { file: "atlas-water.png", width: 256, height: 256 },
    );
    const dirtFrame =
      terrainDb.frames.push({
        a: 1,
        x: 0,
        y: 0,
        w: 256,
        h: 256,
        ox: 0,
        oy: 0,
        sw: 256,
        sh: 256,
      }) - 1;
    const waterFrame =
      terrainDb.frames.push({
        a: 2,
        x: 0,
        y: 0,
        w: 256,
        h: 256,
        ox: 0,
        oy: 0,
        sw: 256,
        sh: 256,
      }) - 1;
    terrainDb.terrainBackgrounds = {
      dirt: { patchSize: 4, frames: [dirtFrame], color: [0.5, 0.4, 0.3, 1] },
      water: { patchSize: 4, frames: [waterFrame], color: [0.2, 0.3, 0.4, 1] },
    };
    const loadAtlasImage = vi.fn<AssetSource["loadAtlasImage"]>(async (index) => {
      return { id: `atlas-${index}` } as unknown as CanvasImageSource;
    });
    const renderer = await createRenderer({
      assets: { ...assets, loadAtlasImage },
      renderDb: terrainDb,
      createCanvas: () => stubCanvas(),
    });
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };

    await renderer.render(bp, { pixelsPerTile: 32, terrainBackground: "dirt" });
    expect(loadAtlasImage.mock.calls.map(([index]) => index)).toEqual([0, 1]);

    await renderer.render(bp, { pixelsPerTile: 32, terrainBackground: "water" });
    expect(loadAtlasImage.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);
  });

  it("renders directly into a supplied destination canvas", async () => {
    const renderer = await createRenderer({ assets, renderDb: db, createCanvas: stubCanvas });
    const destination = stubCanvas();
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };

    const result = await renderer.render(bp, { canvas: destination, pixelsPerTile: 64 });
    expect(result.canvas).toBe(destination);
    expect(destination.width).toBe(result.width);
    expect(destination.height).toBe(result.height);
  });

  it("aborts after asset loading without mutating the destination canvas", async () => {
    let releaseAtlas: ((image: CanvasImageSource) => void) | undefined;
    const delayedAssets: AssetSource = {
      async loadRenderDb() {
        return db;
      },
      loadAtlasImage() {
        return new Promise((resolve) => {
          releaseAtlas = resolve;
        });
      },
    };
    const renderer = await createRenderer({
      assets: delayedAssets,
      renderDb: db,
      createCanvas: stubCanvas,
    });
    const destination = stubCanvas();
    destination.width = 7;
    destination.height = 9;
    const controller = new AbortController();
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };

    const pending = renderer.render(bp, { canvas: destination, signal: controller.signal });
    controller.abort();
    releaseAtlas?.(fakeImage);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(destination.width).toBe(7);
    expect(destination.height).toBe(9);
  });

  it("reuses icon crops and silhouettes on repeated renders", async () => {
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: imageDataCanvas,
    });
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [
        {
          entity_number: 1,
          name: "assembling-machine-1",
          position: { x: 0.5, y: 0.5 },
          recipe: "iron-gear-wheel",
        },
      ],
    };

    const first = await renderer.render(bp, { altMode: true, profile: true });
    const second = await renderer.render(bp, { altMode: true, profile: true });
    expect(first.profile?.iconCacheMisses).toBeGreaterThan(0);
    expect(first.profile?.silhouetteCacheMisses).toBeGreaterThan(0);
    expect(second.profile?.iconCacheHits).toBeGreaterThan(0);
    expect(second.profile?.silhouetteCacheHits).toBeGreaterThan(0);
    expect(second.profile?.iconCacheMisses).toBe(0);
    expect(second.profile?.silhouetteCacheMisses).toBe(0);
  });

  it("selects blueprint by path from a book document", async () => {
    const renderer = await createRenderer({
      assets,
      renderDb: db,
      createCanvas: () => stubCanvas(),
    });

    const doc: BlueprintDocument = {
      blueprint_book: {
        item: "blueprint-book",
        version: 2 * 2 ** 48,
        active_index: 0,
        blueprints: [
          {
            index: 0,
            blueprint: {
              item: "blueprint",
              version: 2 * 2 ** 48,
              label: "first",
              entities: [
                {
                  entity_number: 1,
                  name: "wooden-chest",
                  position: { x: 0.5, y: 0.5 },
                },
              ],
            },
          },
          {
            index: 1,
            blueprint: {
              item: "blueprint",
              version: 2 * 2 ** 48,
              label: "second",
              entities: [
                {
                  entity_number: 1,
                  name: "inserter-like",
                  position: { x: 1.5, y: 1.5 },
                  direction: 4,
                },
              ],
            },
          },
        ],
      },
    };

    const out = await renderer.render(doc, { blueprintPath: [1] });
    // inserter-like only — one object sprite
    const entities = new Set(
      out.drawList.commands.filter((c) => c.entity !== 0).map((c) => c.entity),
    );
    expect(entities.has(1)).toBe(true);
    // Should be inserter (direction4), not chest with shadow (2 sprites)
    const sprites = out.drawList.commands.filter((c) => c.kind === "sprite");
    expect(sprites).toHaveLength(1);
  });
});
