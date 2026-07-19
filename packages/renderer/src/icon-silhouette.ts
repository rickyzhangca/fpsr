import type { ImageDataLike, ImageSource } from "./host.js";

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
  drawImage(image: ImageSource, dx: number, dy: number): void;
  createImageData?(sw: number, sh: number): ImageDataLike;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageDataLike;
  putImageData(data: ImageDataLike, dx: number, dy: number): void;
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
  const alpha = new Uint8Array(width * height);
  for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = src[pixel * 4 + 3]!;
  const out = new Uint8ClampedArray(src.length);
  writeBlurredBlackRgba(alpha, out, width, height, r);
  return out;
}

/** Box dilation on the alpha channel; output RGB is solid black. */
function dilateAlphaChannel(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) {
    const out = new Uint8Array(width * height);
    for (let pixel = 0; pixel < out.length; pixel++) out[pixel] = src[pixel * 4 + 3]!;
    return out;
  }

  const r = Math.floor(radius);
  if (r <= 0) return dilateAlphaChannel(src, width, height, 0);

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

  // Vertical sliding maximum.
  const out = new Uint8Array(width * height);
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
      out[y * width + x] = horizontal[deque[head]! * width + x]!;
    }
  }
  return out;
}

function writeBlurredBlackRgba(
  alpha: Uint8Array,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.floor(radius);
  if (r <= 0) {
    for (let pixel = 0; pixel < alpha.length; pixel++) {
      const i = pixel * 4;
      target[i] = 0;
      target[i + 1] = 0;
      target[i + 2] = 0;
      target[i + 3] = alpha[pixel]!;
    }
    return;
  }

  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const srcRow = y * width;
    const integralRow = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x++) {
      rowSum += alpha[srcRow + x]!;
      integral[integralRow + x + 1] = integral[previousRow + x + 1]! + rowSum;
    }
  }

  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - r);
    const bottom = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - r);
      const right = Math.min(width, x + r + 1);
      const sum =
        integral[bottom * stride + right]! -
        integral[top * stride + right]! -
        integral[bottom * stride + left]! +
        integral[top * stride + left]!;
      const i = (y * width + x) * 4;
      target[i] = 0;
      target[i + 1] = 0;
      target[i + 2] = 0;
      target[i + 3] = Math.round(sum / ((right - left) * (bottom - top)));
    }
  }
}

/** Box dilation on the alpha channel; output RGB is solid black. */
export function dilateAlphaBox(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const alpha = dilateAlphaChannel(src, width, height, radius);
  const out = new Uint8ClampedArray(src.length);
  writeBlurredBlackRgba(alpha, out, width, height, 0);
  return out;
}

/** Fused silhouette operation used by the canvas path to avoid RGBA intermediates. */
export function dilateAndBlurAlphaBox(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  dilateRadius: number,
  blurRadius: number,
): Uint8ClampedArray {
  const alpha = dilateAlphaChannel(src, width, height, dilateRadius);
  const out = new Uint8ClampedArray(src.length);
  writeBlurredBlackRgba(alpha, out, width, height, blurRadius);
  return out;
}

export interface SilhouetteCanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): ImageDataContext | null;
}

/** Bake from an already-cropped icon without reading back a second offscreen canvas. */
export function bakeEntityInfoSilhouetteFromImageData(
  iconData: ImageDataLike,
  createCanvas: (width: number, height: number) => SilhouetteCanvasLike,
  dilateRadius = ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  blurRadius = ENTITY_INFO_SILHOUETTE_BLUR_PX,
): ImageSource | undefined {
  const iconWidth = iconData.width;
  const iconHeight = iconData.height;
  const pad = entityInfoSilhouettePadPx(dilateRadius, blurRadius);
  const width = iconWidth + 2 * pad;
  const height = iconHeight + 2 * pad;
  const canvas = createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  const imageData = ctx.createImageData?.(width, height) ?? ctx.getImageData(0, 0, width, height);
  for (let y = 0; y < iconHeight; y++) {
    for (let x = 0; x < iconWidth; x++) {
      const source = (y * iconWidth + x) * 4 + 3;
      const target = ((y + pad) * width + x + pad) * 4 + 3;
      imageData.data[target] = iconData.data[source]!;
    }
  }
  const alpha = dilateAlphaChannel(imageData.data, width, height, dilateRadius);
  writeBlurredBlackRgba(alpha, imageData.data, width, height, blurRadius);
  ctx.putImageData(imageData, 0, 0);
  return canvas as unknown as ImageSource;
}

/**
 * Dilate and blur an isolated icon crop into a padded black silhouette image.
 * Returns undefined when the canvas context cannot read/write ImageData.
 */
export function bakeEntityInfoSilhouette(
  iconImage: ImageSource,
  iconWidth: number,
  iconHeight: number,
  createCanvas: (width: number, height: number) => SilhouetteCanvasLike,
  dilateRadius = ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  blurRadius = ENTITY_INFO_SILHOUETTE_BLUR_PX,
): ImageSource | undefined {
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
  const alpha = dilateAlphaChannel(imageData.data, width, height, dilateRadius);
  writeBlurredBlackRgba(alpha, imageData.data, width, height, blurRadius);
  ctx.putImageData(imageData, 0, 0);
  return canvas as unknown as ImageSource;
}
