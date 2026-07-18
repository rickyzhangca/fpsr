import type { BlueprintEntity } from "../types/blueprint.js";
import type { LayerGroup } from "../types/render-db.js";

export const DIR_DELTA: Record<0 | 4 | 8 | 12, [number, number]> = {
  0: [0, -1],
  4: [1, 0],
  8: [0, 1],
  12: [-1, 0],
};

/**
 * Map a 16-way blueprint direction to a layer variant index per the indexing
 * contract in render-db.ts.
 */
export function dir16ToIndex(direction: number, indexing: LayerGroup["indexing"]): number {
  const d = ((direction % 16) + 16) % 16;
  switch (indexing) {
    case "single":
      return 0;
    case "direction4":
      return Math.floor(d / 4) % 4;
    case "direction8":
      return Math.floor(d / 2) % 8;
    case "direction16":
      return d;
    case "resolver":
      return 0;
  }
}

export function cardinalDirection(direction: number | undefined): 0 | 4 | 8 | 12 {
  const d = direction ?? 0;
  const snapped = (Math.round(d / 4) * 4) % 16;
  if (snapped === 0 || snapped === 4 || snapped === 8 || snapped === 12) {
    return snapped;
  }
  return 0;
}

export function opposite(dir: 0 | 4 | 8 | 12): 0 | 4 | 8 | 12 {
  return ((dir + 8) % 16) as 0 | 4 | 8 | 12;
}

/** Rotate a local (north-facing) offset by entity direction. */
export function rotateOffset(x: number, y: number, dir: 0 | 4 | 8 | 12): [number, number] {
  switch (dir) {
    case 0:
      return [x, y];
    case 4:
      return [-y, x];
    case 8:
      return [-x, -y];
    case 12:
      return [y, -x];
  }
}

export function posKey(x: number, y: number): string {
  return `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
}

export type NeighborGrid = Map<string, BlueprintEntity[]>;

export function hasNeighbor(
  grid: NeighborGrid,
  x: number,
  y: number,
  predicate: (e: BlueprintEntity) => boolean,
): boolean {
  const list = grid.get(posKey(x, y));
  if (!list) return false;
  return list.some(predicate);
}

export function buildNeighborGrid(entities: BlueprintEntity[]): NeighborGrid {
  const grid: NeighborGrid = new Map();
  for (const e of entities) {
    const key = posKey(e.position.x, e.position.y);
    const list = grid.get(key);
    if (list) list.push(e);
    else grid.set(key, [e]);
  }
  return grid;
}
