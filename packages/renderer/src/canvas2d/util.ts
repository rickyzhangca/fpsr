import type { FrameMeta } from "../types/render-db.js";

export function packedWidth(frame: FrameMeta): number {
  return frame.pw ?? frame.w;
}

export function packedHeight(frame: FrameMeta): number {
  return frame.ph ?? frame.h;
}

export function rgba([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
}
