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
});
