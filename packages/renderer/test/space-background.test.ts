import { describe, expect, it } from "vite-plus/test";
import type { Canvas2DContextLike } from "../src/canvas2d.js";
import { drawSpaceBackground, drawSpacePlanet } from "../src/space-background.js";
import type { FrameMeta } from "../src/types/render-db.js";

describe("drawSpaceBackground", () => {
  it("fills black then paints deterministic star dots", () => {
    const fills: Array<{ color: string; x: number; y: number; w: number; h: number }> = [];
    let fillStyle = "";
    const context = {
      set fillStyle(value: string) {
        fillStyle = value;
      },
      fillRect(x: number, y: number, w: number, h: number) {
        fills.push({ color: fillStyle, x, y, w, h });
      },
    } as unknown as Canvas2DContextLike;

    drawSpaceBackground(context, 112, 112);
    drawSpaceBackground(context, 112, 112);

    expect(fills[0]).toEqual({ color: "#000000", x: 0, y: 0, w: 112, h: 112 });
    const firstPass = fills.slice(0, fills.length / 2);
    const secondPass = fills.slice(fills.length / 2);
    expect(secondPass).toEqual(firstPass);
    expect(firstPass.length).toBeGreaterThan(1);
    expect(firstPass.slice(1).every((fill) => fill.color.startsWith("rgb("))).toBe(true);
  });

  it("no-ops on empty dimensions", () => {
    const fills: unknown[] = [];
    const context = {
      set fillStyle(_value: string) {},
      fillRect(...args: unknown[]) {
        fills.push(args);
      },
    } as unknown as Canvas2DContextLike;
    drawSpaceBackground(context, 0, 10);
    drawSpaceBackground(context, 10, 0);
    expect(fills).toHaveLength(0);
  });

  it("draws an optional planet after the starfield", () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    let smoothing = false;
    const context = {
      get imageSmoothingEnabled() {
        return smoothing;
      },
      set imageSmoothingEnabled(value: boolean) {
        smoothing = value;
        calls.push({ method: "set imageSmoothingEnabled", args: [value] });
      },
      set fillStyle(_value: string) {},
      fillRect(...args: unknown[]) {
        calls.push({ method: "fillRect", args });
      },
      drawImage(...args: unknown[]) {
        calls.push({ method: "drawImage", args });
      },
    } as unknown as Canvas2DContextLike;

    const frame: FrameMeta = {
      a: 0,
      x: 2,
      y: 4,
      w: 28,
      h: 26,
      ox: 2,
      oy: 3,
      sw: 32,
      sh: 32,
    };
    const image = { id: "planet" };
    drawSpaceBackground(context, 200, 200, {
      planet: { frame, image: image as CanvasImageSource },
    });

    const draw = calls.find((call) => call.method === "drawImage");
    expect(draw).toBeDefined();
    expect(draw?.args[0]).toBe(image);
    expect(draw?.args[1]).toBe(2);
    expect(draw?.args[2]).toBe(4);
    expect(draw?.args[3]).toBe(28);
    expect(draw?.args[4]).toBe(26);
    // Radius = 0.5 * min(200,200) = 100, then floor to 140
    const radius = 140;
    const scale = (radius * 2) / 32;
    expect(draw?.args[5]).toBeCloseTo(100 + (-680 / 600) * radius - radius + 2 * scale, 5);
    expect(draw?.args[6]).toBeCloseTo(100 + (601 / 600) * radius - radius + 3 * scale, 5);
    expect(draw?.args[7]).toBeCloseTo(28 * scale, 5);
    expect(draw?.args[8]).toBeCloseTo(26 * scale, 5);
    expect(calls.some((call) => call.method === "fillRect")).toBe(true);
  });
});

describe("drawSpacePlanet", () => {
  it("no-ops when the frame has empty source size", () => {
    const calls: unknown[] = [];
    const context = {
      imageSmoothingEnabled: false,
      drawImage(...args: unknown[]) {
        calls.push(args);
      },
    } as unknown as Canvas2DContextLike;
    drawSpacePlanet(context, 100, 100, {
      frame: { a: 0, x: 0, y: 0, w: 10, h: 10, ox: 0, oy: 0, sw: 0, sh: 32 },
      image: {} as CanvasImageSource,
    });
    expect(calls).toHaveLength(0);
  });
});
