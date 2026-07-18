import type { BlueprintEntity } from "../types/blueprint.js";
import type { RenderDb } from "../types/render-db.js";
import { type NeighborGrid, cardinalDirection, hasNeighbor } from "./shared.js";

export function wallMask(entity: BlueprintEntity, grid: NeighborGrid, db: RenderDb): string {
  const { x, y } = entity.position;
  const pred = (n: BlueprintEntity) => {
    const nd = db.entities[n.name];
    return nd?.kind === "wall" || nd?.kind === "gate";
  };
  const n = hasNeighbor(grid, x, y - 1, pred) ? "1" : "0";
  const e = hasNeighbor(grid, x + 1, y, pred) ? "1" : "0";
  const s = hasNeighbor(grid, x, y + 1, pred) ? "1" : "0";
  const w = hasNeighbor(grid, x - 1, y, pred) ? "1" : "0";
  return `${n}${e}${s}${w}`;
}

export function gateVariantKey(entity: BlueprintEntity): string {
  const dir = cardinalDirection(entity.direction);
  // Horizontal gate when facing N/S (spans E-W); vertical when facing E/W.
  return dir === 0 || dir === 8 ? "horizontal" : "vertical";
}
