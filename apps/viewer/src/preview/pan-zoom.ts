export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 16;
/** Initial fit never exceeds true size — only zoom out to fit, never zoom in. */
export const FIT_ZOOM_MAX = 1;
export const ZOOM_BUTTON_STEP = 0.25;
/** Pinch-to-zoom sensitivity: zoom *= exp(-deltaY * step). Higher = faster zoom. */
export const PINCH_ZOOM_STEP = 0.01;
/** How far past hard pan bounds the user can drag before it resists (px). */
export const RUBBERBAND_DISTANCE = 100;
/** Matches react-viewer-pan-zoom spring.transition. */
export const SPRING_TRANSITION = "transform 0.1s ease-out";

export type View = {
  zoom: number;
  panX: number;
  panY: number;
};

export const clampZoom = (zoom: number): number => {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
};

export const fitZoomFor = (
  shellW: number,
  shellH: number,
  contentW: number,
  contentH: number,
): number => {
  return Math.min(shellW / contentW, shellH / contentH, FIT_ZOOM_MAX);
};

export const clampPan = (
  zoom: number,
  panX: number,
  panY: number,
  shellW: number,
  shellH: number,
  contentW: number,
  contentH: number,
): {
  panX: number;
  panY: number;
} => {
  const scaledW = contentW * zoom;
  const scaledH = contentH * zoom;
  const maxX = Math.max(0, (scaledW - shellW) / 2);
  const maxY = Math.max(0, (scaledH - shellH) / 2);
  return {
    panX: Math.min(maxX, Math.max(-maxX, panX)),
    panY: Math.min(maxY, Math.max(-maxY, panY)),
  };
};

export const rubberbandPan = (
  zoom: number,
  panX: number,
  panY: number,
  shellW: number,
  shellH: number,
  contentW: number,
  contentH: number,
  distance: number,
): {
  panX: number;
  panY: number;
} => {
  const hard = clampPan(zoom, panX, panY, shellW, shellH, contentW, contentH);
  return {
    panX: Math.min(hard.panX + distance, Math.max(hard.panX - distance, panX)),
    panY: Math.min(hard.panY + distance, Math.max(hard.panY - distance, panY)),
  };
};
