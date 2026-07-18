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
  translations: number[][];
  rotations: number[];
  scales: number[][];
} {
  const fills: unknown[][] = [];
  const draws: unknown[][] = [];
  const translations: number[][] = [];
  const rotations: number[] = [];
  const scales: number[][] = [];
  let smoothing = true;
  const ctx = {
    save() {},
    restore() {},
    translate(x: number, y: number) {
      translations.push([x, y]);
    },
    rotate(angle: number) {
      rotations.push(angle);
    },
    scale(x: number, y: number) {
      scales.push([x, y]);
    },
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
  return { ctx, fills, draws, translations, rotations, scales };
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
    expect(shifted.draws[0]?.slice(3, 5)).toEqual([256, 256]);
    expect(shifted.draws[0]?.slice(5, 9)).toEqual([-64, 0, 256, 256]);
    expect(first.translations).toHaveLength(0);
    expect(shifted.translations).toHaveLength(0);
  });

  it("handles negative cells and lower-density packed pixels", () => {
    const { ctx, draws, translations } = mockContext();
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
    expect(translations).toHaveLength(0);
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
    expect(first.every((frameX, index) => index === 0 || frameX !== first[index - 1])).toBe(true);
  });

  it("uses stable per-background layouts without transforming authored patches", () => {
    const frames = Array.from({ length: 16 }, (_, index) => terrainFrame(index * 256));
    const render = (seed: number) => {
      const { ctx, draws, rotations, scales } = mockContext();
      drawTerrainBackground(ctx, 1024, 1024, {
        tileFrame: { minX: 0, minY: 0, maxX: 16, maxY: 16 },
        pixelsPerTile: 64,
        frames,
        images: [fakeImage],
        background: { ...terrain(frames.map((_, index) => index)), seed },
        fallbackColor: [0, 0, 0, 1],
      });
      return {
        frames: draws.map((args) => args[1]),
        rotations,
        scales,
      };
    };

    const first = render(101);
    expect(render(101)).toEqual(first);
    expect(render(202)).not.toEqual(first);
    expect(first.rotations).toHaveLength(0);
    expect(first.scales).toHaveLength(0);
  });

  it("subdivides into complete smaller authored patches without cropping", () => {
    const frames = [
      terrainFrame(0),
      { ...terrainFrame(256), w: 128, h: 128, sw: 128, sh: 128 },
      { ...terrainFrame(384), w: 64, h: 64, sw: 64, sh: 64 },
    ];
    const { ctx, draws, rotations, scales } = mockContext();
    drawTerrainBackground(ctx, 256, 256, {
      tileFrame: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      pixelsPerTile: 64,
      frames,
      images: [fakeImage],
      background: {
        ...terrain([0]),
        probability: 0,
        patches: [
          { patchSize: 2, frames: [1], probability: 0 },
          { patchSize: 1, frames: [2] },
        ],
      },
      fallbackColor: [0, 0, 0, 1],
    });

    expect(draws).toHaveLength(16);
    expect(draws.every((args) => args.slice(1, 5).join(",") === "384,0,64,64")).toBe(true);
    expect(draws.every((args) => args.slice(7, 9).join(",") === "64,64")).toBe(true);
    expect(rotations).toHaveLength(0);
    expect(scales).toHaveLength(0);
  });

  it("shares snapped pixel boundaries at fractional output density", () => {
    const frame = { ...terrainFrame(0), w: 64, h: 64, sw: 64, sh: 64 };
    const { ctx, draws } = mockContext();
    drawTerrainBackground(ctx, 94, 47, {
      tileFrame: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
      pixelsPerTile: 23.5,
      frames: [frame],
      images: [fakeImage],
      background: {
        patchSize: 1,
        frames: [0],
        color: [0.1, 0.1, 0.1, 1],
      },
      fallbackColor: [0, 0, 0, 1],
    });

    expect(draws).toHaveLength(8);
    expect(draws.slice(0, 4).map((args) => [args[5], args[7]])).toEqual([
      [0, 24],
      [24, 23],
      [47, 24],
      [71, 23],
    ]);
    expect(draws[0]?.slice(6, 9)).toEqual([0, 24, 24]);
    expect(draws[4]?.slice(6, 9)).toEqual([24, 24, 23]);
  });

  it("keeps legacy backgrounds on complete authored patches at low density", () => {
    const frames = Array.from({ length: 16 }, (_, index) => terrainFrame(index * 256));
    const { ctx, draws } = mockContext();
    drawTerrainBackground(ctx, 64, 64, {
      tileFrame: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
      pixelsPerTile: 1,
      frames,
      images: [fakeImage],
      background: terrain(frames.map((_, index) => index)),
      fallbackColor: [0, 0, 0, 1],
    });

    expect(draws).toHaveLength(16 * 16);
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
