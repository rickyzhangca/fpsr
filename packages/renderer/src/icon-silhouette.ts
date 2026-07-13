/** Pixel radius for feMorphology-style alpha dilation on entity-info icons. */
export const ENTITY_INFO_SILHOUETTE_RADIUS_PX = 12;
/** Soft blur applied after dilation to feather the silhouette edge. */
export const ENTITY_INFO_SILHOUETTE_BLUR_PX = 16;

/** Total source-pixel padding around icon crops for spread + blur. */
export function entityInfoSilhouettePadPx(
  dilateRadius = ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  blurRadius = ENTITY_INFO_SILHOUETTE_BLUR_PX,
): number {
  return dilateRadius + blurRadius;
}

export interface ImageDataContext {
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(data: ImageData, dx: number, dy: number): void;
}

/** Box blur on the alpha channel; output RGB is solid black. */
export function blurAlphaBox(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return src;

  const r = Math.floor(radius);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        const row = sy * width;
        for (let dx = -r; dx <= r; dx++) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) continue;
          sum += src[(row + sx) * 4 + 3]!;
          count++;
        }
      }
      const i = (y * width + x) * 4;
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = count === 0 ? 0 : Math.round(sum / count);
    }
  }
  return out;
}

/** Box dilation on the alpha channel; output RGB is solid black. */
export function dilateAlphaBox(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) {
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = src[i + 3]!;
    }
    return out;
  }

  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    const yMin = Math.max(0, y - radius);
    const yMax = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      let maxA = 0;
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);
      for (let sy = yMin; sy <= yMax; sy++) {
        const row = sy * width;
        for (let sx = xMin; sx <= xMax; sx++) {
          const a = src[(row + sx) * 4 + 3]!;
          if (a > maxA) maxA = a;
        }
      }
      const i = (y * width + x) * 4;
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = maxA;
    }
  }
  return out;
}

export interface SilhouetteCanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): ImageDataContext | null;
}

/**
 * Dilate and blur an isolated icon crop into a padded black silhouette image.
 * Returns undefined when the canvas context cannot read/write ImageData.
 */
export function bakeEntityInfoSilhouette(
  iconImage: CanvasImageSource,
  iconWidth: number,
  iconHeight: number,
  createCanvas: (width: number, height: number) => SilhouetteCanvasLike,
  dilateRadius = ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  blurRadius = ENTITY_INFO_SILHOUETTE_BLUR_PX,
): CanvasImageSource | undefined {
  const pad = entityInfoSilhouettePadPx(dilateRadius, blurRadius);
  const width = iconWidth + 2 * pad;
  const height = iconHeight + 2 * pad;
  const canvas = createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  ctx.drawImage(iconImage, pad, pad);
  const imageData = ctx.getImageData(0, 0, width, height);
  let pixels = dilateAlphaBox(imageData.data, width, height, dilateRadius);
  if (blurRadius > 0) {
    pixels = blurAlphaBox(pixels, width, height, blurRadius);
  }
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  return canvas as unknown as CanvasImageSource;
}
