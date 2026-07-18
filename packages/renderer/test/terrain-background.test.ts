import { describe, expect, it } from "vite-plus/test";
import type { Canvas2DContextLike } from "../src/canvas2d.js";
import { drawTerrainBackground } from "../src/terrain-background.js";
import type { FrameMeta, TerrainPatchBackground } from "../src/types/render-db.js";

const fakeImage = { id: "terrain-atlas" } as unknown as CanvasImageSource;

function terrainFrame(x: number, packedSize = 256): FrameMeta {
  return {
    a: 0,
    x,
    y: 0,
    w: 256,
    h: 256,
    ox: 0,
    oy: 0,
    sw: 256,
    sh: 256,
    ...(packedSize === 256 ? {} : { pw: packedSize, ph: packedSize }),
  };
}

function terrain(frames: number[], weights?: number[]): TerrainPatchBackground {
  return {
    patchSize: 4,
    frames,
    ...(weights ? { weights } : {}),
    color: [141 / 255, 104 / 255, 60 / 255, 1],
  };
}

function mockContext(): {
  ctx: Canvas2DContextLike;
  fills: unknown[][];
  draws: unknown[][];
} {
  const fills: unknown[][] = [];
  const draws: unknown[][] = [];
  let smoothing = true;
  const ctx = {
    set fillStyle(_value: string) {},
    fillRect(...args: unknown[]) {
      fills.push(args);
    },
    drawImage(...args: unknown[]) {
      draws.push(args);
    },
    get imageSmoothingEnabled() {
      return smoothing;
    },
    set imageSmoothingEnabled(value: boolean) {
      smoothing = value;
    },
  } as unknown as Canvas2DContextLike;
  return { ctx, fills, draws };
}

describe("drawTerrainBackground", () => {
  it("anchors patch selection and placement to absolute map coordinates", () => {
    const frames = Array.from({ length: 16 }, (_, index) => terrainFrame(index * 256));
    const first = mockContext();
    const shifted = mockContext();

    drawTerrainBackground(first.ctx, 256, 256, {
      tileFrame: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      pixelsPerTile: 64,
      frames,
      images: [fakeImage],
      background: terrain(frames.map((_, index) => index)),
      fallbackColor: [0, 0, 0, 1],
    });
    drawTerrainBackground(shifted.ctx, 256, 256, {
      tileFrame: { minX: 1, minY: 0, maxX: 5, maxY: 4 },
      pixelsPerTile: 64,
      frames,
      images: [fakeImage],
      background: terrain(frames.map((_, index) => index)),
      fallbackColor: [0, 0, 0, 1],
    });

    expect(first.draws).toHaveLength(1);
    expect(shifted.draws).toHaveLength(2);
    expect(shifted.draws[0]?.slice(0, 5)).toEqual(first.draws[0]?.slice(0, 5));
    expect(shifted.draws[0]?.slice(5, 9)).toEqual([-64, 0, 256, 256]);
  });

  it("handles negative cells and lower-density packed pixels", () => {
    const { ctx, draws } = mockContext();
    drawTerrainBackground(ctx, 256, 256, {
      tileFrame: { minX: -1, minY: -1, maxX: 3, maxY: 3 },
      pixelsPerTile: 64,
      frames: [terrainFrame(10, 128)],
      images: [fakeImage],
      background: terrain([0]),
      fallbackColor: [0, 0, 0, 1],
    });

    expect(draws).toHaveLength(4);
    expect(draws[0]?.slice(1, 5)).toEqual([10, 0, 128, 128]);
    expect(draws[0]?.slice(5, 9)).toEqual([-192, -192, 256, 256]);
  });

  it("selects varied authored patches deterministically", () => {
    const frames = Array.from({ length: 16 }, (_, index) => terrainFrame(index * 256));
    const definition = terrain(frames.map((_, index) => index));
    const render = () => {
      const { ctx, draws } = mockContext();
      drawTerrainBackground(ctx, 4096, 256, {
        tileFrame: { minX: 0, minY: 0, maxX: 64, maxY: 4 },
        pixelsPerTile: 64,
        frames,
        images: [fakeImage],
        background: definition,
        fallbackColor: [0, 0, 0, 1],
      });
      return draws.map((args) => args[1]);
    };

    const first = render();
    expect(render()).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it("uses the solid fallback when terrain art is unavailable", () => {
    const { ctx, fills, draws } = mockContext();
    drawTerrainBackground(ctx, 96, 64, {
      tileFrame: { minX: 0, minY: 0, maxX: 3, maxY: 2 },
      pixelsPerTile: 32,
      frames: [],
      images: [],
      fallbackColor: [0.2, 0.3, 0.4, 1],
    });

    expect(fills).toEqual([[0, 0, 96, 64]]);
    expect(draws).toHaveLength(0);
  });

  it("does nothing for an empty canvas", () => {
    const { ctx, fills, draws } = mockContext();
    drawTerrainBackground(ctx, 0, 64, {
      tileFrame: { minX: 0, minY: 0, maxX: 0, maxY: 2 },
      pixelsPerTile: 32,
      frames: [],
      images: [],
      fallbackColor: [0, 0, 0, 1],
    });

    expect(fills).toHaveLength(0);
    expect(draws).toHaveLength(0);
  });
});
