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
  if (r <= 0) return src;
  const out = new Uint8ClampedArray(src.length);
  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));

  // Integral alpha image makes every clipped box sum O(1). Keeping the
  // division until the final pixel preserves the previous rounding exactly.
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const srcRow = y * width;
    const integralRow = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x++) {
      rowSum += src[(srcRow + x) * 4 + 3]!;
      integral[integralRow + x + 1] = integral[previousRow + x + 1]! + rowSum;
    }
  }

  for (let y = 0; y < height; y++) {
    const yMin = Math.max(0, y - r);
    const yMax = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const xMin = Math.max(0, x - r);
      const xMax = Math.min(width - 1, x + r);
      const left = xMin;
      const right = xMax + 1;
      const top = yMin;
      const bottom = yMax + 1;
      const sum =
        integral[bottom * stride + right]! -
        integral[top * stride + right]! -
        integral[bottom * stride + left]! +
        integral[top * stride + left]!;
      const count = (right - left) * (bottom - top);
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

  const r = Math.floor(radius);
  if (r <= 0) return dilateAlphaBox(src, width, height, 0);

  const horizontal = new Uint8Array(width * height);
  const deque = new Int32Array(Math.max(width, height));

  // Horizontal sliding maximum.
  for (let y = 0; y < height; y++) {
    let head = 0;
    let tail = 0;
    let next = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const addThrough = Math.min(width - 1, x + r);
      while (next <= addThrough) {
        const alpha = src[(row + next) * 4 + 3]!;
        while (tail > head) {
          const previous = deque[tail - 1]!;
          if (src[(row + previous) * 4 + 3]! > alpha) break;
          tail--;
        }
        deque[tail++] = next++;
      }
      const removeBefore = x - r;
      while (tail > head && deque[head]! < removeBefore) head++;
      horizontal[row + x] = src[(row + deque[head]!) * 4 + 3]!;
    }
  }

  // Vertical sliding maximum, writing the final black RGBA image.
  const out = new Uint8ClampedArray(src.length);
  for (let x = 0; x < width; x++) {
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let y = 0; y < height; y++) {
      const addThrough = Math.min(height - 1, y + r);
      while (next <= addThrough) {
        const alpha = horizontal[next * width + x]!;
        while (tail > head) {
          const previous = deque[tail - 1]!;
          if (horizontal[previous * width + x]! > alpha) break;
          tail--;
        }
        deque[tail++] = next++;
      }
      const removeBefore = y - r;
      while (tail > head && deque[head]! < removeBefore) head++;
      const i = (y * width + x) * 4;
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = horizontal[deque[head]! * width + x]!;
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
