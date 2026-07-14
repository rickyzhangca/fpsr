import { describe, expect, it, vi } from "vite-plus/test";
import type { AssetSource } from "../src/assets.js";
import type { Canvas2DContextLike } from "../src/canvas2d.js";
import * as canvas2d from "../src/canvas2d.js";
import type { CanvasLike, RenderProgressEvent } from "../src/renderer.js";
import { createRenderer } from "../src/renderer.js";
import type { Blueprint, BlueprintDocument } from "../src/types/blueprint.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

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
