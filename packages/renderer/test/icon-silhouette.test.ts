import { describe, expect, it } from "vite-plus/test";
import {
  blurAlphaBox,
  dilateAlphaBox,
  ENTITY_INFO_SILHOUETTE_BLUR_PX,
  ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  entityInfoSilhouettePadPx,
} from "../src/icon-silhouette.js";

function rgbaPixel(r: number, g: number, b: number, a: number): number[] {
  return [r, g, b, a];
}

function naiveBlur(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const r = Math.floor(radius);
  if (r <= 0) return src;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let sy = Math.max(0, y - r); sy <= Math.min(height - 1, y + r); sy++) {
        for (let sx = Math.max(0, x - r); sx <= Math.min(width - 1, x + r); sx++) {
          sum += src[(sy * width + sx) * 4 + 3]!;
          count++;
        }
      }
      out[(y * width + x) * 4 + 3] = Math.round(sum / count);
    }
  }
  return out;
}

function naiveDilate(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const r = Math.floor(radius);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let alpha = 0;
      for (let sy = Math.max(0, y - r); sy <= Math.min(height - 1, y + r); sy++) {
        for (let sx = Math.max(0, x - r); sx <= Math.min(width - 1, x + r); sx++) {
          alpha = Math.max(alpha, src[(sy * width + sx) * 4 + 3]!);
        }
      }
      out[(y * width + x) * 4 + 3] = alpha;
    }
  }
  return out;
}

describe("icon silhouette alpha ops", () => {
  it("expands a single opaque pixel by the requested radius", () => {
    const width = 5;
    const height = 5;
    const src = new Uint8ClampedArray(width * height * 4);
    const center = (2 * width + 2) * 4;
    src.set([...rgbaPixel(255, 128, 64, 255)], center);

    const out = dilateAlphaBox(src, width, height, 1);
    expect(out[center + 3]).toBe(255);
    expect(out[(2 * width + 1) * 4 + 3]).toBe(255);
    expect(out[(1 * width + 2) * 4 + 3]).toBe(255);
    expect(out[(0 * width + 0) * 4 + 3]).toBe(0);
    expect(out[center]).toBe(0);
    expect(out[center + 1]).toBe(0);
    expect(out[center + 2]).toBe(0);
  });

  it("softens hard alpha edges with blur", () => {
    const width = 5;
    const height = 5;
    const src = new Uint8ClampedArray(width * height * 4);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        const i = (y * width + x) * 4;
        src[i + 3] = 255;
      }
    }

    const out = blurAlphaBox(src, width, height, 1);
    const center = (2 * width + 2) * 4;
    const east = (2 * width + 3) * 4;
    expect(out[center + 3]).toBe(255);
    expect(out[east + 3]!).toBeGreaterThan(0);
    expect(out[east + 3]!).toBeLessThan(255);
  });

  it("includes blur in the silhouette padding budget", () => {
    expect(entityInfoSilhouettePadPx()).toBe(
      ENTITY_INFO_SILHOUETTE_RADIUS_PX + ENTITY_INFO_SILHOUETTE_BLUR_PX,
    );
  });

  it("matches the naive alpha operations across randomized masks and edge sizes", () => {
    let seed = 0x51f15e;
    const randomByte = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    };

    for (const [width, height] of [
      [1, 1],
      [2, 7],
      [9, 3],
      [17, 13],
    ] as const) {
      const src = new Uint8ClampedArray(width * height * 4);
      for (let i = 3; i < src.length; i += 4) src[i] = randomByte();
      for (const radius of [0, 1, 2, 4, 12, 16]) {
        expect(blurAlphaBox(src, width, height, radius)).toEqual(
          naiveBlur(src, width, height, radius),
        );
        expect(dilateAlphaBox(src, width, height, radius)).toEqual(
          naiveDilate(src, width, height, radius),
        );
      }
    }
  });
});
