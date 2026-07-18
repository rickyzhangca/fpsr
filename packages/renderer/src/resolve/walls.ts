import type { BlueprintEntity } from "../types/blueprint.js";
import type { RenderDb } from "../types/render-db.js";
import { type NeighborGrid, cardinalDirection, hasNeighbor } from "./shared.js";

/**
 * Factorio only authors south-extending wall pieces (corner_*_down, straight_vertical,
 * t_up, …). A north link is drawn by the northern neighbour’s south-reaching sprite,
 * so picture choice depends on E/S/W only.
 */
export function wallPictureKey(e: boolean, s: boolean, w: boolean): string {
  if (s) {
    if (e && w) return "0111"; // t_up
    if (e) return "0110"; // corner_right_down
    if (w) return "0011"; // corner_left_down
    return "1010"; // straight_vertical
  }
  if (e && w) return "0101"; // straight_horizontal
  if (e) return "0100"; // ending_right
  if (w) return "0001"; // ending_left
  return "0000"; // single
}

export function wallMask(entity: BlueprintEntity, grid: NeighborGrid, db: RenderDb): string {
  const { x, y } = entity.position;
  const pred = (n: BlueprintEntity) => {
    const nd = db.entities[n.name];
    return nd?.kind === "wall" || nd?.kind === "gate";
  };
  const e = hasNeighbor(grid, x + 1, y, pred);
  const s = hasNeighbor(grid, x, y + 1, pred);
  const w = hasNeighbor(grid, x - 1, y, pred);
  return wallPictureKey(e, s, w);
}

export function gateVariantKey(entity: BlueprintEntity): string {
  const dir = cardinalDirection(entity.direction);
  // Horizontal gate when facing N/S (spans E-W); vertical when facing E/W.
  return dir === 0 || dir === 8 ? "horizontal" : "vertical";
}
