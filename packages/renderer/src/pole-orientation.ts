/**
 * Electric-pole facing from wire topology (FBE WireConnections.getPowerPoleDirection).
 * Factorio auto-orients poles from connections; blueprints often omit `direction`.
 */

import type { Blueprint, BlueprintEntity } from "./types/blueprint.js";

export interface Point2 {
  x: number;
  y: number;
}

/** Angle of point relative to centre, degrees CCW from +X (FBE util.getAngle). */
export function getAngle(cX: number, cY: number, pX: number, pY: number): number {
  const x = pX - cX;
  const y = pY - cY;
  if (x === 0 && y === 0) return 0;
  const angle = (Math.acos(x / Math.sqrt(x * x + y * y)) * 180) / Math.PI;
  if (y < 0) return 360 - angle;
  return angle;
}

function angleToSector(angle: number): 0 | 1 | 2 | 3 {
  const cwAngle = 360 - angle;
  const sectorAngle = 360 / 8;
  const offset = sectorAngle * 1.5;
  let newAngle = cwAngle - offset;
  if (Math.sign(newAngle) === -1) {
    newAngle = 360 + newAngle;
  }
  const sector = Math.floor(newAngle / sectorAngle);
  return (sector % 4) as 0 | 1 | 2 | 3;
}

/**
 * Average neighbor bearings into a cardinal direction 0|4|8|12 (FBE).
 * Y is inverted to match Factorio's screen-space angle convention.
 */
export function powerPoleRotationFromNeighbors(centre: Point2, points: Point2[]): number {
  if (points.length === 0) return 0;
  const sectorSum = points
    .map((p) => getAngle(0, 0, p.x - centre.x, (p.y - centre.y) * -1))
    .map(angleToSector)
    .reduce((acc, sec) => acc + sec, 0 as number);
  return Math.floor(sectorSum / points.length) * 4;
}

/**
 * Neighbor entity numbers connected to `entityNumber` by any wire in `bp.wires`.
 */
export function wireNeighborNumbers(bp: Blueprint, entityNumber: number): number[] {
  const wires = bp.wires;
  if (!wires?.length) return [];
  const out: number[] = [];
  for (const w of wires) {
    if (!Array.isArray(w) || w.length < 4) continue;
    const [a, , b] = w;
    if (a === entityNumber) out.push(b);
    else if (b === entityNumber) out.push(a);
  }
  return out;
}

/**
 * Effective pole direction: explicit blueprint `direction` when set, else FBE
 * inference from wire-neighbor positions. Returns 0|4|8|12 (or 0 if alone).
 */
export function effectivePowerPoleDirection(
  entity: BlueprintEntity,
  bp: Blueprint,
  byNumber: Map<number, BlueprintEntity>,
): number {
  if (entity.direction !== undefined && entity.direction !== null) {
    return ((entity.direction % 16) + 16) % 16;
  }
  const neighborNums = wireNeighborNumbers(bp, entity.entity_number);
  if (neighborNums.length === 0) return 0;
  const points: Point2[] = [];
  for (const n of neighborNums) {
    const other = byNumber.get(n);
    if (other) points.push(other.position);
  }
  if (points.length === 0) return 0;
  return powerPoleRotationFromNeighbors(entity.position, points);
}

/**
 * Precompute effective directions for every electric-pole entity in the blueprint.
 */
export function buildPowerPoleDirections(
  bp: Blueprint,
  entities: BlueprintEntity[],
  isElectricPole: (entity: BlueprintEntity) => boolean,
): Map<number, number> {
  const byNumber = new Map(entities.map((e) => [e.entity_number, e]));
  const out = new Map<number, number>();
  for (const e of entities) {
    if (!isElectricPole(e)) continue;
    out.set(e.entity_number, effectivePowerPoleDirection(e, bp, byNumber));
  }
  return out;
}
