/**
 * DOM-free host abstractions for canvas / image types.
 *
 * Published declarations must type-check in a strict Node-only TypeScript
 * project (no DOM lib, no skipLibCheck). Browser and skia-canvas values are
 * accepted at runtime as structural matches.
 */

/** Opaque decoded image used as a canvas drawImage source. */
export type ImageSource = object;

/** Minimal ImageData shape used for silhouette baking. */
export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export type CanvasFillStyle = string;

export type CanvasLineCap = "butt" | "round" | "square";

export type CanvasTextAlign = "start" | "end" | "left" | "right" | "center";

export type CanvasTextBaseline =
  | "top"
  | "hanging"
  | "middle"
  | "alphabetic"
  | "ideographic"
  | "bottom";

/** Subset of CSS compositing operators used by the Canvas2D backend. */
export type GlobalCompositeOperation =
  | "source-over"
  | "source-in"
  | "source-out"
  | "source-atop"
  | "destination-over"
  | "destination-in"
  | "destination-out"
  | "destination-atop"
  | "lighter"
  | "copy"
  | "xor"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/** Options passed to AssetSource load methods. */
export interface AssetLoadOptions {
  /**
   * Abort waiting for this load. Shared in-flight fetches are not cancelled
   * for other concurrent consumers; only the waiting caller is rejected.
   * Aborted waits never poison the shared success cache.
   */
  signal?: AbortSignal;
}
