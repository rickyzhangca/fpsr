import type { Blueprint } from "./types/blueprint.js";

export type SnapGridRect = { x: number; y: number; w: number; h: number };

/**
 * Blueprint-local axis-aligned snap rectangle from Factorio snap metadata.
 * Returns null when snap-to-grid is absent or non-positive.
 *
 * The preview box is always anchored at the blueprint origin `(0,0)` with size
 * `snap-to-grid`. `position-relative-to-grid` only affects world absolute
 * placement, not the local preview rectangle.
 */
export function snapGridRect(bp: Blueprint): SnapGridRect | null {
  const snap = bp["snap-to-grid"];
  if (!snap || !isPositiveFinite(snap.x) || !isPositiveFinite(snap.y)) return null;
  return { x: 0, y: 0, w: snap.x, h: snap.y };
}

function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}
