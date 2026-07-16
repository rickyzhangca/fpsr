import { describe, expect, it } from "vite-plus/test";
import { type Canvas2DContextLike, executeDrawList } from "../src/canvas2d.js";
import type { DrawList } from "../src/types/draw-list.js";
import { TRIMMED_FRAME, makeMiniDb } from "./fixtures/mini-db.js";

type Call = { method: string; args: unknown[] };

function mockCtx(): Canvas2DContextLike & { calls: Call[]; _alpha: number } {
  const calls: Call[] = [];
  let alpha = 1;
  const ctx = {
    calls,
    _alpha: 1,
    save() {
      calls.push({ method: "save", args: [] });
    },
    restore() {
      calls.push({ method: "restore", args: [] });
    },
    scale(x: number, y: number) {
      calls.push({ method: "scale", args: [x, y] });
    },
    rotate(angle: number) {
      calls.push({ method: "rotate", args: [angle] });
    },
    translate(x: number, y: number) {
      calls.push({ method: "translate", args: [x, y] });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ method: "fillRect", args: [x, y, w, h] });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      calls.push({ method: "clearRect", args: [x, y, w, h] });
    },
    beginPath() {
      calls.push({ method: "beginPath", args: [] });
    },
    moveTo(x: number, y: number) {
      calls.push({ method: "moveTo", args: [x, y] });
    },
    lineTo(x: number, y: number) {
      calls.push({ method: "lineTo", args: [x, y] });
    },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
      calls.push({ method: "quadraticCurveTo", args: [cpx, cpy, x, y] });
    },
    stroke() {
      calls.push({ method: "stroke", args: [] });
    },
    fill() {
      calls.push({ method: "fill", args: [] });
    },
    rect(x: number, y: number, w: number, h: number) {
      calls.push({ method: "rect", args: [x, y, w, h] });
    },
    clip() {
      calls.push({ method: "clip", args: [] });
    },
    drawImage(...args: unknown[]) {
      calls.push({ method: "drawImage", args });
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ method: "fillText", args: [text, x, y] });
    },
    set fillStyle(value: string) {
      calls.push({ method: "set fillStyle", args: [value] });
    },
    set strokeStyle(value: string) {
      calls.push({ method: "set strokeStyle", args: [value] });
    },
    set lineWidth(value: number) {
      calls.push({ method: "set lineWidth", args: [value] });
    },
    set lineCap(value: CanvasLineCap) {
      calls.push({ method: "set lineCap", args: [value] });
    },
    set globalAlpha(value: number) {
      alpha = value;
      ctx._alpha = value;
      calls.push({ method: "set globalAlpha", args: [value] });
    },
    get globalAlpha() {
      return alpha;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      calls.push({ method: "set globalCompositeOperation", args: [value] });
    },
    get globalCompositeOperation(): GlobalCompositeOperation {
      return "source-over";
    },
    set filter(value: string) {
      calls.push({ method: "set filter", args: [value] });
    },
    set font(value: string) {
      calls.push({ method: "set font", args: [value] });
    },
    set textBaseline(value: CanvasTextBaseline) {
      calls.push({ method: "set textBaseline", args: [value] });
    },
    set textAlign(value: CanvasTextAlign) {
      calls.push({ method: "set textAlign", args: [value] });
    },
    set imageSmoothingEnabled(value: boolean) {
      calls.push({ method: "set imageSmoothingEnabled", args: [value] });
    },
    set imageSmoothingQuality(value: "low" | "medium" | "high") {
      calls.push({ method: "set imageSmoothingQuality", args: [value] });
    },
  };
  return ctx as Canvas2DContextLike & { calls: Call[]; _alpha: number };
}

describe("executeDrawList", () => {
  const db = makeMiniDb();
  const fakeImage = { __img: true } as unknown as CanvasImageSource;

  it("respects command order and draws rect then sprite", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      commands: [
        {
          kind: "rect",
          layer: 10,
          sortY: 0,
          sortX: 0,
          entity: 0,
          sub: 0,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          color: [1, 0, 0, 1],
        },
        {
          kind: "sprite",
          layer: 70,
          sortY: 1,
          sortX: 0,
          entity: 1,
          sub: 0,
          frame: 0,
          x: 1,
          y: 1,
          w: 0.5,
          h: 0.5,
        },
      ],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      padTiles: 0,
      frames: db.frames,
    });

    const methods = ctx.calls.map((c) => c.method);
    const fillIdx = methods.indexOf("fillRect");
    const drawIdx = methods.indexOf("drawImage");
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(drawIdx).toBeGreaterThan(fillIdx);
  });

  it("uses FrameMeta source rect and applies trim offset", () => {
    // Use trimmed frame (index 2): x=4,y=6,w=24,h=20,ox=4,oy=6,sw=32,sh=32
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "sprite",
          layer: 70,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 0,
          frame: 2,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
        },
      ],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      padTiles: 0,
      frames: db.frames,
    });

    const draw = ctx.calls.find((c) => c.method === "drawImage");
    expect(draw).toBeDefined();
    const args = draw?.args ?? [];
    // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
    expect(args[0]).toBe(fakeImage);
    expect(args[1]).toBe(TRIMMED_FRAME.x);
    expect(args[2]).toBe(TRIMMED_FRAME.y);
    expect(args[3]).toBe(TRIMMED_FRAME.w);
    expect(args[4]).toBe(TRIMMED_FRAME.h);
    // scale = 32/32 = 1 → trimmed dest at (ox, oy) = (4, 6), size 24×20
    expect(args[5]).toBe(4);
    expect(args[6]).toBe(6);
    expect(args[7]).toBe(24);
    expect(args[8]).toBe(20);
  });

  it("draws a source sub-rect for material tile cells", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "sprite",
          layer: 2,
          sortY: 0,
          sortX: 0,
          entity: 0,
          sub: 0,
          frame: 5,
          x: 3,
          y: 5,
          w: 1,
          h: 1,
          src: { x: 24, y: 40, w: 8, h: 8 },
        },
      ],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      padTiles: 0,
      frames: db.frames,
    });

    const draw = ctx.calls.find((c) => c.method === "drawImage");
    expect(draw).toBeDefined();
    const args = draw?.args ?? [];
    expect(args[1]).toBe(24);
    expect(args[2]).toBe(40);
    expect(args[3]).toBe(8);
    expect(args[4]).toBe(8);
    expect(args[5]).toBe(3 * 32);
    expect(args[6]).toBe(5 * 32);
    expect(args[7]).toBe(32);
    expect(args[8]).toBe(32);
  });

  it("uses packed dimensions for a 1x atlas while preserving logical geometry", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "sprite",
          layer: 70,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 0,
          frame: 2,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
        },
      ],
    };
    const frames = db.frames.map((frame, index) =>
      index === 2 ? { ...frame, pw: 12, ph: 10 } : frame,
    );
    const ctx = mockCtx();

    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      padTiles: 0,
      frames,
    });

    const args = ctx.calls.find((call) => call.method === "drawImage")?.args ?? [];
    expect(args.slice(1, 5)).toEqual([TRIMMED_FRAME.x, TRIMMED_FRAME.y, 12, 10]);
    expect(args.slice(5, 9)).toEqual([4, 6, 24, 20]);
  });

  it("flipX produces negative-scale transform around center", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "sprite",
          layer: 70,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 0,
          frame: 2,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          flipX: true,
        },
      ],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      padTiles: 0,
      frames: db.frames,
    });

    expect(ctx.calls.some((c) => c.method === "save")).toBe(true);
    expect(ctx.calls.some((c) => c.method === "scale" && c.args[0] === -1 && c.args[1] === 1)).toBe(
      true,
    );
    const translate = ctx.calls.find((c) => c.method === "translate");
    // trimmed center = (4+12, 6+10) = (16, 16)
    expect(translate?.args).toEqual([16, 16]);
    expect(ctx.calls.some((c) => c.method === "restore")).toBe(true);
  });

  it("shadow sets globalAlpha to 0.5", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "sprite",
          layer: 60,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 0,
          frame: 0,
          x: 0,
          y: 0,
          w: 0.5,
          h: 0.5,
          shadow: true,
        },
      ],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      padTiles: 0,
      frames: db.frames,
    });

    expect(ctx.calls.some((c) => c.method === "set globalAlpha" && c.args[0] === 0.5)).toBe(true);
    // restored after
    const alphaSets = ctx.calls.filter((c) => c.method === "set globalAlpha");
    expect(alphaSets.at(-1)?.args[0]).toBe(1);
  });

  it("uses one bounded scratch canvas for distant shadow tiles", () => {
    const shadow = (x: number, entity: number) => ({
      kind: "sprite" as const,
      layer: 60,
      sortY: 0,
      sortX: x,
      entity,
      sub: 0,
      frame: 0,
      x,
      y: 0,
      w: 0.5,
      h: 0.5,
      shadow: true,
    });
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
      commands: [shadow(0, 1), shadow(3.5, 2)],
    };
    const ctx = mockCtx();
    const scratchCtx = mockCtx();
    let created = 0;
    const stats = {
      shadowRuns: 0,
      shadowTiles: 0,
      shadowCompositedPixels: 0,
      shadowPeakScratchPixels: 0,
    };

    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 16,
      frames: db.frames,
      shadowTileSize: 16,
      stats,
      createCanvas(width, height) {
        created++;
        return {
          width,
          height,
          getContext: () => scratchCtx,
        };
      },
    });

    expect(created).toBe(1);
    expect(stats.shadowRuns).toBe(1);
    expect(stats.shadowTiles).toBe(2);
    expect(stats.shadowPeakScratchPixels).toBe(16 * 16);
    expect(scratchCtx.calls.filter((call) => call.method === "clearRect")).toHaveLength(2);
    expect(ctx.calls.filter((call) => call.method === "drawImage")).toHaveLength(2);
  });

  it("draws atlas-backed icon backing and rotates the foreground", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "icon",
          layer: 58,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 0,
          frame: 3,
          backingFrame: 0,
          rotation: 90,
          x: 0.5,
          y: 0.5,
          size: 0.5,
        },
      ],
    };
    const ctx = mockCtx();
    const isolatedImage = { __isolated: true } as unknown as CanvasImageSource;
    const silhouetteImage = { __silhouette: true } as unknown as CanvasImageSource;
    const frames = [{ ...db.frames[0]!, w: 53, h: 53, sw: 53, sh: 53 }, ...db.frames.slice(1)];
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      frames,
      iconImages: new Map([[3, isolatedImage]]),
      silhouetteImages: new Map([[3, silhouetteImage]]),
    });
    const draws = ctx.calls.filter((c) => c.method === "drawImage");
    expect(draws).toHaveLength(3);
    // A scale-0.5 icon is 16 px; Factorio's 53 px backing scales to 26.5 px.
    expect(draws[0]?.args[7]).toBe(26.5);
    expect(draws[1]?.args[0]).toBe(silhouetteImage);
    expect(draws[2]?.args[0]).toBe(isolatedImage);
    expect(draws[2]?.args[7]).toBe(16);
    expect(ctx.calls.some((c) => c.method === "set filter")).toBe(false);
    expect(ctx.calls.some((c) => c.method === "set globalAlpha" && c.args[0] === 0.16)).toBe(true);
    expect(ctx.calls.some((c) => c.method === "rotate" && c.args[0] === Math.PI / 2)).toBe(true);
  });

  it("draws request-pin backing at full alpha without silhouette", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "icon",
          layer: 58,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 20,
          frame: 3,
          backingFrame: 0,
          backingStyle: "request-pin",
          x: 0.5,
          y: 0.5,
          size: 0.5,
        },
      ],
    };
    const ctx = mockCtx();
    const isolatedImage = { __isolated: true } as unknown as CanvasImageSource;
    const silhouetteImage = { __silhouette: true } as unknown as CanvasImageSource;
    const frames = [
      { ...db.frames[0]!, w: 48, h: 63, ox: 8, oy: 1, sw: 64, sh: 64 },
      ...db.frames.slice(1),
    ];
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      frames,
      iconImages: new Map([[3, isolatedImage]]),
      silhouetteImages: new Map([[3, silhouetteImage]]),
    });
    const draws = ctx.calls.filter((c) => c.method === "drawImage");
    expect(draws).toHaveLength(2);
    // scale-0.5 command → 16 px opaque chrome; 44/48 of trimmed 48px maps to that.
    expect(draws[0]?.args[7]).toBeCloseTo(16 * (48 / 44));
    expect(draws[0]?.args[8]).toBeCloseTo((63 / 44) * 16);
    expect(draws[1]?.args[0]).toBe(isolatedImage);
    // Icon is 0.7× command size = 11.2 px, shifted up into the pin body.
    expect(draws[1]?.args[7]).toBeCloseTo(11.2);
    expect(ctx.calls.some((c) => c.method === "set globalAlpha" && c.args[0] === 0.16)).toBe(false);
  });

  it("draws a silhouette-only icon without an entity-info backing", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "icon",
          layer: 58,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 112,
          frame: 3,
          silhouette: true,
          x: 0.5,
          y: 0.5,
          size: 0.5,
        },
      ],
    };
    const ctx = mockCtx();
    const isolatedImage = { __isolated: true } as unknown as CanvasImageSource;
    const silhouetteImage = { __silhouette: true } as unknown as CanvasImageSource;
    executeDrawList(ctx, list, [fakeImage], {
      pixelsPerTile: 32,
      frames: db.frames,
      iconImages: new Map([[3, isolatedImage]]),
      silhouetteImages: new Map([[3, silhouetteImage]]),
    });

    const draws = ctx.calls.filter((call) => call.method === "drawImage");
    expect(draws).toHaveLength(2);
    expect(draws[0]?.args[0]).toBe(silhouetteImage);
    expect(draws[1]?.args[0]).toBe(isolatedImage);
    expect(
      ctx.calls.some((call) => call.method === "set globalAlpha" && call.args[0] === 0.16),
    ).toBe(false);
  });

  it("fills background when set", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [], {
      pixelsPerTile: 32,
      padTiles: 1,
      background: [0.1, 0.2, 0.3, 1],
      frames: db.frames,
    });

    expect(ctx.calls.some((c) => c.method === "set fillStyle")).toBe(true);
    // size = (1-0+2)*32 = 96
    expect(
      ctx.calls.some((c) => c.method === "fillRect" && c.args[2] === 96 && c.args[3] === 96),
    ).toBe(true);
  });

  it("draws checkerboard before entity commands when showCheckerboard is set", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      commands: [
        {
          kind: "rect",
          layer: 10,
          sortY: 0,
          sortX: 0,
          entity: 0,
          sub: 0,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          color: [1, 0, 0, 1],
        },
      ],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [], {
      pixelsPerTile: 32,
      padTiles: 0,
      tileFrame: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      showCheckerboard: true,
      frames: db.frames,
    });

    const methods = ctx.calls.map((c) => c.method);
    const firstFillRect = methods.indexOf("fillRect");
    const entityFillRect = methods.indexOf("fillRect", firstFillRect + 1);
    expect(firstFillRect).toBeGreaterThanOrEqual(0);
    expect(entityFillRect).toBeGreaterThan(firstFillRect);
    expect(ctx.calls.some((c) => c.method === "set fillStyle" && c.args[0] === "#252525")).toBe(
      true,
    );
  });

  it("prefers checkerboard over solid background when both are set", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [], {
      pixelsPerTile: 32,
      padTiles: 0,
      tileFrame: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      showCheckerboard: true,
      background: [0.1, 0.2, 0.3, 1],
      frames: db.frames,
    });

    expect(ctx.calls.some((c) => c.method === "set fillStyle" && c.args[0] === "#252525")).toBe(
      true,
    );
    expect(
      ctx.calls.some((c) => c.method === "set fillStyle" && String(c.args[0]).includes("rgba")),
    ).toBe(false);
  });

  it("draws coordinate overlay after entity commands when showCoordinates is set", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      commands: [
        {
          kind: "rect",
          layer: 10,
          sortY: 0,
          sortX: 0,
          entity: 0,
          sub: 0,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          color: [1, 0, 0, 1],
        },
      ],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [], {
      pixelsPerTile: 32,
      padTiles: 0,
      tileFrame: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      showCoordinates: true,
      frames: db.frames,
    });

    const methods = ctx.calls.map((c) => c.method);
    const fillIdx = methods.indexOf("fillRect");
    const strokeIdx = methods.indexOf("stroke");
    const fillTextIdx = methods.indexOf("fillText");
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(strokeIdx).toBeGreaterThan(fillIdx);
    expect(fillTextIdx).toBeGreaterThan(strokeIdx);
    expect(ctx.calls.some((c) => c.method === "fillText" && c.args[0] === "0,0")).toBe(true);
  });

  it("does not draw coordinate labels when showCoordinates is unset", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: [],
    };
    const ctx = mockCtx();
    executeDrawList(ctx, list, [], {
      pixelsPerTile: 32,
      padTiles: 0,
      frames: db.frames,
    });

    expect(ctx.calls.some((c) => c.method === "fillText")).toBe(false);
  });
});
