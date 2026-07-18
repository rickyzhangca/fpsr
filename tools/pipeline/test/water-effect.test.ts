import { describe, expect, it } from "vite-plus/test";
import {
  bakeFrozenWaterSurface,
  sampleWrappedRed,
  shadeFrozenWaterPixel,
  type FrozenWaterParameters,
  type RgbaImageData,
} from "../src/water-effect.js";

const PARAMETERS: FrozenWaterParameters = {
  effectColor: [21 / 255, 147 / 255, 167 / 255],
  specularLightness: [1, 1, 1],
  foamColor: [(230 / 255) * 2.47, 2.47, (252 / 255) * 2.47],
  darkThreshold: 0.295,
  reflectionThreshold: 0.29,
  specularThreshold: 0.33,
  animationSpeed: 0.07,
  animationScale: 0.006,
  frozenTime: 0,
};
const UNDERWATER_COLOR: [number, number, number] = [0.15, 0.4, 0.5];

function rgbaImage(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[],
): RgbaImageData {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = pixel(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = color[0] ?? 0;
      data[offset + 1] = color[1] ?? 0;
      data[offset + 2] = color[2] ?? 0;
      data[offset + 3] = color[3] ?? 255;
    }
  }
  return { data, width, height };
}

function edgeMeanAbsoluteDifference(
  image: Buffer,
  width: number,
  height: number,
  vertical: boolean,
): number {
  const samples = vertical ? height : width;
  let difference = 0;
  for (let sample = 0; sample < samples; sample++) {
    const first = vertical ? sample * width * 4 : sample * 4;
    const last = vertical ? (sample * width + width - 1) * 4 : ((height - 1) * width + sample) * 4;
    for (let channel = 0; channel < 3; channel++) {
      difference += Math.abs((image[first + channel] ?? 0) - (image[last + channel] ?? 0));
    }
  }
  return difference / (samples * 3);
}

describe("frozen Factorio water effect", () => {
  it("samples the repeating noise texture continuously", () => {
    const noise = rgbaImage(2, 2, (x, y) => [x * 80 + y * 140, 0, 0, 255]);
    expect(sampleWrappedRed(noise, 0.31, 0.77)).toBeCloseTo(
      sampleWrappedRed(noise, 2.31, -1.23),
      10,
    );
  });

  it("matches the shader port for a representative pixel", () => {
    const color = shadeFrozenWaterPixel(0.42, [0.2, 0.15, 0.08], PARAMETERS);
    expect(color[0]).toBeCloseTo(0.0463492776, 9);
    expect(color[1]).toBeCloseTo(0.3309418129, 9);
    expect(color[2]).toBeCloseTo(0.377139465, 9);
    expect(color[3]).toBeCloseTo(0.85, 9);
  });

  it("composites the premultiplied water over its underwater base", () => {
    const mask = [40, 51, 12, 255];
    const noise = 107;
    const baked = bakeFrozenWaterSurface({
      maskSheet: rgbaImage(1, 1, () => mask),
      maskFrameSize: 1,
      maskFrameCount: 1,
      noiseTexture: rgbaImage(1, 1, () => [noise, 0, 0, 255]),
      parameters: PARAMETERS,
      underwaterColor: UNDERWATER_COLOR,
      supertileTiles: 1,
      sourcePixelsPerTile: 1,
      maskPatchTiles: 1,
      seamBlendTiles: 1,
    });
    const water = shadeFrozenWaterPixel(
      noise / 255,
      [mask[0] / 255, mask[1] / 255, mask[2] / 255],
      PARAMETERS,
    );

    for (let channel = 0; channel < 3; channel++) {
      const expected = (water[channel] ?? 0) + (UNDERWATER_COLOR[channel] ?? 0) * (1 - water[3]);
      expect(baked.rgba[channel]).toBe(Math.round(expected * 255));
    }
    expect(baked.rgba[3]).toBe(255);
  });

  it("bakes a deterministic, non-flat supertile", () => {
    const maskSheet = rgbaImage(4, 2, (x, y) => [x * 35, 20 + y * 10, 5 + x * 20, 255]);
    const noiseTexture = rgbaImage(4, 4, (x, y) => [(x * 41 + y * 67) % 256, 0, 0, 255]);
    const options = {
      maskSheet,
      maskFrameSize: 2,
      maskFrameCount: 2,
      noiseTexture,
      parameters: PARAMETERS,
      underwaterColor: UNDERWATER_COLOR,
      supertileTiles: 4,
      sourcePixelsPerTile: 2,
      maskPatchTiles: 1,
      seamBlendTiles: 1,
    };
    const first = bakeFrozenWaterSurface(options);
    const second = bakeFrozenWaterSurface(options);

    expect(first.width).toBe(8);
    expect(first.height).toBe(8);
    expect(first.rgba).toEqual(second.rgba);
    const colors = new Set<string>();
    for (let offset = 0; offset < first.rgba.length; offset += 4) {
      colors.add(first.rgba.subarray(offset, offset + 3).toString("hex"));
      expect(first.rgba[offset + 3]).toBe(255);
    }
    expect(colors.size).toBeGreaterThan(4);
  });

  it("keeps opposite supertile edges visually continuous", () => {
    const maskSheet = rgbaImage(2, 2, () => [45, 22, 8, 255]);
    const noiseTexture = rgbaImage(8, 8, (x, y) => [(x * 29 + y * 17) % 256, 0, 0, 255]);
    const baked = bakeFrozenWaterSurface({
      maskSheet,
      maskFrameSize: 2,
      maskFrameCount: 1,
      noiseTexture,
      parameters: PARAMETERS,
      underwaterColor: UNDERWATER_COLOR,
      supertileTiles: 8,
      sourcePixelsPerTile: 2,
      maskPatchTiles: 1,
      seamBlendTiles: 2,
    });

    expect(edgeMeanAbsoluteDifference(baked.rgba, baked.width, baked.height, true)).toBeLessThan(
      20,
    );
    expect(edgeMeanAbsoluteDifference(baked.rgba, baked.width, baked.height, false)).toBeLessThan(
      20,
    );
  });

  it("rejects a mask whose frame geometry does not match the tile scale", () => {
    expect(() =>
      bakeFrozenWaterSurface({
        maskSheet: rgbaImage(4, 4, () => [0, 0, 0, 255]),
        maskFrameSize: 4,
        maskFrameCount: 1,
        noiseTexture: rgbaImage(2, 2, () => [0, 0, 0, 255]),
        parameters: PARAMETERS,
        underwaterColor: UNDERWATER_COLOR,
        sourcePixelsPerTile: 2,
        maskPatchTiles: 1,
      }),
    ).toThrow(/expected 2px/);
  });
});
