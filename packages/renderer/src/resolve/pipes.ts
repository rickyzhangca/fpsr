import type { BlueprintEntity } from "../types/blueprint.js";
import type { RenderDb } from "../types/render-db.js";
import {
  DIR_DELTA,
  type NeighborGrid,
  cardinalDirection,
  hasNeighbor,
  opposite,
  posKey,
} from "./shared.js";

interface HeatPortOccupant {
  entityNumber: number;
  direction: 0 | 4 | 8 | 12;
}

type HeatPortGrid = Map<string, HeatPortOccupant[]>;

/** Outward cardinal direction of a distilled heat-connection target offset. */
export function heatPortDirection(ox: number, oy: number): 0 | 4 | 8 | 12 {
  if (Math.abs(ox) >= Math.abs(oy)) return ox >= 0 ? 4 : 12;
  return oy >= 0 ? 8 : 0;
}

/**
 * Index the source tile and facing of every heat port. `heatConnections` stores
 * the adjacent target tile, so step one tile inward to recover the source.
 */
export function buildHeatPortGrid(entities: BlueprintEntity[], db: RenderDb): HeatPortGrid {
  const ports: HeatPortGrid = new Map();
  for (const entity of entities) {
    const def = db.entities[entity.name];
    const connections = def?.data?.heatConnections;
    if (!connections) continue;
    const d = cardinalDirection(entity.direction);
    for (const [ox, oy] of connections[String(d)] ?? []) {
      const direction = heatPortDirection(ox, oy);
      const [dx, dy] = DIR_DELTA[direction];
      const key = posKey(entity.position.x + ox - dx, entity.position.y + oy - dy);
      const list = ports.get(key);
      const occupant = { entityNumber: entity.entity_number, direction };
      if (list) list.push(occupant);
      else ports.set(key, [occupant]);
    }
  }
  return ports;
}

export function heatPortConnected(
  entity: BlueprintEntity,
  targetOffset: [number, number],
  heatPorts: HeatPortGrid,
  grid: NeighborGrid,
  db: RenderDb,
): boolean {
  const [ox, oy] = targetOffset;
  const direction = heatPortDirection(ox, oy);
  const targetX = entity.position.x + ox;
  const targetY = entity.position.y + oy;
  if (hasNeighbor(grid, targetX, targetY, (n) => db.entities[n.name]?.kind === "heat-pipe")) {
    return true;
  }
  return (heatPorts.get(posKey(targetX, targetY)) ?? []).some(
    (port) => port.entityNumber !== entity.entity_number && port.direction === opposite(direction),
  );
}

/**
 * Map: pipe-tile-key → set of NESW sides ("n"|"e"|"s"|"w") that connect to a
 * non-pipe fluid entity via fluidConnections.
 */
export function buildFluidPipeSides(
  entities: BlueprintEntity[],
  db: RenderDb,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entity of entities) {
    const def = db.entities[entity.name];
    if (!def?.data?.fluidConnections) continue;
    if (def.kind === "pipe") continue;
    const fc = def.data.fluidConnections;
    const d = cardinalDirection(entity.direction);
    // Re-derive facing from offset: side = dominant axis from entity center to pipe tile.
    for (const [ox, oy] of fc[String(d)] ?? []) {
      const pipeX = entity.position.x + ox;
      const pipeY = entity.position.y + oy;
      const pk = posKey(pipeX, pipeY);
      // Direction from pipe back toward entity center.
      const dx = entity.position.x - pipeX;
      const dy = entity.position.y - pipeY;
      let side: string;
      if (Math.abs(dx) >= Math.abs(dy)) {
        side = dx > 0 ? "e" : "w";
      } else {
        side = dy > 0 ? "s" : "n";
      }
      let set = map.get(pk);
      if (!set) {
        set = new Set();
        map.set(pk, set);
      }
      set.add(side);
    }
  }
  return map;
}

/**
 * Map: heat-pipe-tile-key -> NESW sides that connect to a non-heat-pipe
 * entity via heatConnections. Large heat entities are indexed by their actual
 * port tile because their entity center is not necessarily adjacent to it.
 */
export function buildHeatPipeSides(
  entities: BlueprintEntity[],
  db: RenderDb,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entity of entities) {
    const def = db.entities[entity.name];
    if (!def?.data?.heatConnections || def.kind === "heat-pipe") continue;
    const d = cardinalDirection(entity.direction);
    for (const [ox, oy] of def.data.heatConnections[String(d)] ?? []) {
      const pipeX = entity.position.x + ox;
      const pipeY = entity.position.y + oy;
      const pk = posKey(pipeX, pipeY);
      const dx = entity.position.x - pipeX;
      const dy = entity.position.y - pipeY;
      const side = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
      let set = map.get(pk);
      if (!set) {
        set = new Set();
        map.set(pk, set);
      }
      set.add(side);
    }
  }
  return map;
}

export function pipeMask(
  entity: BlueprintEntity,
  grid: NeighborGrid,
  db: RenderDb,
  fluidPipeSides: Map<string, Set<string>>,
): string {
  const { x, y } = entity.position;
  const check = (nx: number, ny: number, side: string): boolean => {
    if (hasNeighbor(grid, nx, ny, (n) => db.entities[n.name]?.kind === "pipe")) {
      return true;
    }
    if (fluidPipeSides.get(posKey(x, y))?.has(side)) return true;

    const neighbors = grid.get(posKey(nx, ny));
    if (neighbors) {
      for (const n of neighbors) {
        const nd = db.entities[n.name];
        if (!nd) continue;
        if (nd.protoType === "pipe-to-ground" || n.name === "pipe-to-ground") {
          const openDir = cardinalDirection(n.direction);
          const [dx, dy] = DIR_DELTA[openDir];
          if (Math.abs(n.position.x + dx - x) < 0.01 && Math.abs(n.position.y + dy - y) < 0.01) {
            return true;
          }
        }
        const fc = nd.data?.fluidConnections;
        if (fc) {
          const d = cardinalDirection(n.direction);
          for (const [ox, oy] of fc[String(d)] ?? []) {
            if (Math.abs(n.position.x + ox - x) < 0.01 && Math.abs(n.position.y + oy - y) < 0.01) {
              return true;
            }
          }
        }
      }
    }
    return false;
  };
  const n = check(x, y - 1, "n") ? "1" : "0";
  const e = check(x + 1, y, "e") ? "1" : "0";
  const s = check(x, y + 1, "s") ? "1" : "0";
  const w = check(x - 1, y, "w") ? "1" : "0";
  return `${n}${e}${s}${w}`;
}

export function heatPipeMask(
  entity: BlueprintEntity,
  grid: NeighborGrid,
  db: RenderDb,
  heatPipeSides: Map<string, Set<string>>,
): string {
  const { x, y } = entity.position;
  const check = (nx: number, ny: number, side: string): boolean => {
    if (heatPipeSides.get(posKey(x, y))?.has(side)) return true;
    const neighbors = grid.get(posKey(nx, ny));
    if (!neighbors) return false;
    for (const n of neighbors) {
      const nd = db.entities[n.name];
      if (!nd) continue;
      if (nd.kind === "heat-pipe") return true;
      const hc = nd.data?.heatConnections;
      if (!hc) continue;
      const d = cardinalDirection(n.direction);
      for (const [ox, oy] of hc[String(d)] ?? []) {
        if (Math.abs(n.position.x + ox - x) < 0.01 && Math.abs(n.position.y + oy - y) < 0.01) {
          return true;
        }
      }
    }
    return false;
  };
  const n = check(x, y - 1, "n") ? "1" : "0";
  const e = check(x + 1, y, "e") ? "1" : "0";
  const s = check(x, y + 1, "s") ? "1" : "0";
  const w = check(x - 1, y, "w") ? "1" : "0";
  return `${n}${e}${s}${w}`;
}
