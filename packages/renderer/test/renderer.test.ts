import { describe, expect, it, vi } from "vite-plus/test";
import type { AssetSource } from "../src/assets.js";
import type { Canvas2DContextLike } from "../src/canvas2d.js";
import * as canvas2d from "../src/canvas2d.js";
import type { CanvasLike } from "../src/renderer.js";
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
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    stroke() {},
    fill() {},
    rect() {},
    clip() {},
    drawImage() {},
    fillText() {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
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
    expect(p.output.width).toBe(cold.width);
    expect(p.cold).toBe(true);
    expect(p.assets.some((a) => a.kind === "atlas" && !a.cached)).toBe(true);

    const warm = await renderer.render(bp, { pixelsPerTile: 32, padTiles: 1, profile: true });
    expect(warm.profile?.cold).toBe(false);
    expect(warm.profile?.assets.every((a) => a.cached)).toBe(true);
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
