/**
 * Plan Factorio 2.1 cargo-bay connection graphics (tileset + bridges) between
 * space-platform-hub, cargo-bay, and cargo-landing-pad footprints.
 */

import type { Blueprint, BlueprintEntity } from "./types/blueprint.js";
import { type DrawCmd, RENDER_LAYERS, type SpriteCmd } from "./types/draw-list.js";
import type {
  CargoBayConnectionCell,
  CargoBayConnections,
  EntityRenderDef,
  FrameMeta,
  RenderDb,
  SpriteVariant,
} from "./types/render-db.js";

const CONNECTABLE_PROTOS = new Set(["space-platform-hub", "cargo-bay", "cargo-landing-pad"]);
/** Cargo bays are evaluated on Factorio's forced 2x2 build/connection grid. */
const CONNECTION_GRID_SIZE = 2;

/** 8-neighbor offsets clockwise from top-left (Factorio CargoBayConnections docs). */
const NEIGHBOR8: readonly [number, number][] = [
  [-1, -1], // 0 top-left
  [0, -1], // 1 top
  [1, -1], // 2 top-right
  [1, 0], // 3 right
  [1, 1], // 4 bottom-right
  [0, 1], // 5 bottom
  [-1, 1], // 6 bottom-left
  [-1, 0], // 7 left
];

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function hashTile(x: number, y: number): number {
  // Same family as tile material hashing in plan.ts — stable across runs.
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

interface ConnectionCellPosition {
  /** Logical coordinates on the 2x2 cargo-connection grid. */
  gridX: number;
  gridY: number;
  /** World-space center of the 2x2 cell, in tile units. */
  x: number;
  y: number;
}

function footprintCells(entity: BlueprintEntity, def: EntityRenderDef): ConnectionCellPosition[] {
  const [[x1, y1], [x2, y2]] = def.collisionBox;
  const minX = Math.floor(entity.position.x + x1 + 1e-6);
  const maxX = Math.ceil(entity.position.x + x2 - 1e-6) - 1;
  const minY = Math.floor(entity.position.y + y1 + 1e-6);
  const maxY = Math.ceil(entity.position.y + y2 - 1e-6) - 1;
  const cells: ConnectionCellPosition[] = [];
  for (let y = minY; y <= maxY; y += CONNECTION_GRID_SIZE) {
    for (let x = minX; x <= maxX; x += CONNECTION_GRID_SIZE) {
      const centerX = x + CONNECTION_GRID_SIZE / 2;
      const centerY = y + CONNECTION_GRID_SIZE / 2;
      cells.push({
        gridX: Math.floor(centerX / CONNECTION_GRID_SIZE),
        gridY: Math.floor(centerY / CONNECTION_GRID_SIZE),
        x: centerX,
        y: centerY,
      });
    }
  }
  return cells;
}

function spriteDest(
  posX: number,
  posY: number,
  frame: FrameMeta,
  variant: SpriteVariant,
): { x: number; y: number; w: number; h: number } {
  const w = (frame.sw * variant.scale) / 32;
  const h = (frame.sh * variant.scale * (variant.scaleY ?? 1)) / 32;
  const cx = posX + variant.shift[0];
  const cy = posY + variant.shift[1];
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function pickConnections(
  def: EntityRenderDef,
  preferPlatform: boolean,
): CargoBayConnections | undefined {
  return preferPlatform
    ? (def.data?.cargoBayConnectionsPlatform ?? def.data?.cargoBayConnections)
    : (def.data?.cargoBayConnections ?? def.data?.cargoBayConnectionsPlatform);
}

function pickCellVariation(
  groups: CargoBayConnectionCell[][],
  tx: number,
  ty: number,
): CargoBayConnectionCell | undefined {
  if (groups.length === 0) return undefined;
  const groupIndex = groups.length > 1 ? (tx + ty) & 1 : 0;
  const group = groups[groupIndex] ?? groups[0];
  if (!group || group.length === 0) return undefined;
  const variation = group[hashTile(tx, ty) % group.length];
  return variation;
}

function emitCell(
  cell: CargoBayConnectionCell,
  cx: number,
  cy: number,
  db: RenderDb,
  entityNumber: number,
  subBase: number,
  sortY: number,
  sortX: number,
  commands: DrawCmd[],
): number {
  let sub = subBase;
  for (const layer of cell.layers) {
    const frame = db.frames[layer.variant.frame];
    if (!frame) continue;
    const dest = spriteDest(cx, cy, frame, layer.variant);
    const layerName = layer.layer;
    const cmd: SpriteCmd = {
      kind: "sprite",
      layer: RENDER_LAYERS[layerName],
      sortY,
      sortX,
      entity: entityNumber,
      sub: sub++,
      frame: layer.variant.frame,
      x: dest.x,
      y: dest.y,
      w: dest.w,
      h: dest.h,
    };
    if (layer.variant.drawAsShadow) cmd.shadow = true;
    if (layer.variant.tint) cmd.tint = layer.variant.tint;
    commands.push(cmd);
  }
  return sub;
}

function occupancyMask(occ: Set<string>, tx: number, ty: number): number {
  let mask = 0;
  for (let bit = 0; bit < 8; bit++) {
    const [dx, dy] = NEIGHBOR8[bit]!;
    if (occ.has(tileKey(tx + dx, ty + dy))) mask |= 1 << bit;
  }
  return mask;
}

interface ConnectableInfo {
  entity: BlueprintEntity;
  def: EntityRenderDef;
  connections: CargoBayConnections;
  cells: ConnectionCellPosition[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function buildConnectables(
  bp: Blueprint,
  db: RenderDb,
  preferPlatform: boolean,
): ConnectableInfo[] {
  const out: ConnectableInfo[] = [];
  for (const entity of bp.entities ?? []) {
    const def = db.entities[entity.name];
    if (!def || (!CONNECTABLE_PROTOS.has(def.protoType) && !CONNECTABLE_PROTOS.has(entity.name))) {
      continue;
    }
    // Match by entity name (protoType may be generic "simple" distill kind — use name).
    if (
      entity.name !== "space-platform-hub" &&
      entity.name !== "cargo-bay" &&
      entity.name !== "cargo-landing-pad"
    ) {
      continue;
    }
    const connections = pickConnections(def, preferPlatform);
    if (!connections) continue;
    const cells = footprintCells(entity, def);
    if (cells.length === 0) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const [[x1, y1], [x2, y2]] = def.collisionBox;
    minX = Math.floor(entity.position.x + x1 + 1e-6);
    maxX = Math.ceil(entity.position.x + x2 - 1e-6) - 1;
    minY = Math.floor(entity.position.y + y1 + 1e-6);
    maxY = Math.ceil(entity.position.y + y2 - 1e-6) - 1;
    out.push({ entity, def, connections, cells, minX, maxX, minY, maxY });
  }
  return out;
}

/**
 * Emit cargo-bay connection tileset + bridge sprites for the blueprint.
 * Returns the number of commands appended.
 */
export function emitCargoBayConnections(
  bp: Blueprint,
  db: RenderDb,
  preferPlatform: boolean,
  commands: DrawCmd[],
): void {
  const connectables = buildConnectables(bp, db, preferPlatform);
  if (connectables.length === 0) return;

  const occ = new Set<string>();
  const owner = new Map<string, { connectable: ConnectableInfo; cell: ConnectionCellPosition }>();
  for (const c of connectables) {
    for (const cell of c.cells) {
      const k = tileKey(cell.gridX, cell.gridY);
      occ.add(k);
      owner.set(k, { connectable: c, cell });
    }
  }

  let sub = 10_000;
  const connRef = connectables[0]!.connections;

  // CargoBayConnections tiles are the connectable body's lower/perimeter art,
  // not just seam decoration. Factorio evaluates the 8-neighbour mask for
  // every occupied 2x2 footprint cell; interior masks map to 0/undefined while
  // boundary masks select walls and corners. The sprites are authored for this
  // 2-tile cadence—emitting them once per world tile makes the body one ring
  // too large and overlaps the same art too densely.
  for (const key of occ) {
    const [xs, ys] = key.split(",");
    const gridX = Number(xs);
    const gridY = Number(ys);
    const mask = occupancyMask(occ, gridX, gridY);
    const mapped = connRef.tilesetMapping[String(mask)];
    if (mapped == null || mapped === 0) continue;
    const indices = Array.isArray(mapped) ? mapped : [mapped];
    const owned = owner.get(key);
    if (!owned) continue;
    const { cell, connectable: cellOwner } = owned;
    const sortY = cellOwner.entity.position.y + cellOwner.def.collisionBox[1][1];
    const sortX = cellOwner.entity.position.x;

    for (const oneBased of indices) {
      if (oneBased === 0) continue;
      const groups = connRef.tileset[oneBased - 1];
      if (!groups) continue;
      const variation = pickCellVariation(groups, gridX, gridY);
      if (!variation) continue;
      sub = emitCell(
        variation,
        cell.x,
        cell.y,
        db,
        cellOwner.entity.entity_number,
        sub,
        sortY,
        sortX,
        commands,
      );
    }
  }

  // Bridges between orthogonally adjacent connectable pairs.
  for (let i = 0; i < connectables.length; i++) {
    for (let j = i + 1; j < connectables.length; j++) {
      const a = connectables[i]!;
      const b = connectables[j]!;
      emitBridgePair(a, b, db, commands, () => {
        const s = sub;
        sub += 20;
        return s;
      });
    }
  }
}

function sharedEdge(
  a: ConnectableInfo,
  b: ConnectableInfo,
): {
  axis: "h" | "v";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  midX: number;
  midY: number;
} | null {
  // Horizontal adjacency: a's right + 1 == b's left (or swap)
  if (a.maxX + 1 === b.minX || b.maxX + 1 === a.minX) {
    const left = a.maxX + 1 === b.minX ? a : b;
    const right = left === a ? b : a;
    const y0 = Math.max(left.minY, right.minY);
    const y1 = Math.min(left.maxY, right.maxY);
    if (y1 < y0) return null;
    const midX = left.maxX + 1;
    const midY = (y0 + y1 + 1) / 2;
    return { axis: "h", x0: left.maxX, x1: right.minX, y0, y1, midX, midY };
  }
  // Vertical adjacency
  if (a.maxY + 1 === b.minY || b.maxY + 1 === a.minY) {
    const top = a.maxY + 1 === b.minY ? a : b;
    const bottom = top === a ? b : a;
    const x0 = Math.max(top.minX, bottom.minX);
    const x1 = Math.min(top.maxX, bottom.maxX);
    if (x1 < x0) return null;
    const midX = (x0 + x1 + 1) / 2;
    const midY = top.maxY + 1;
    return { axis: "v", x0, x1, y0: top.maxY, y1: bottom.minY, midX, midY };
  }
  return null;
}

function emitBridgePair(
  a: ConnectableInfo,
  b: ConnectableInfo,
  db: RenderDb,
  commands: DrawCmd[],
  nextSub: () => number,
): void {
  const edge = sharedEdge(a, b);
  if (!edge) return;
  const span = edge.axis === "h" ? edge.y1 - edge.y0 + 1 : edge.x1 - edge.x0 + 1;
  const bridges = a.connections.bridges;
  const wide = span >= 4;
  const cells =
    edge.axis === "h"
      ? wide
        ? bridges.horizontalWide
        : bridges.horizontalNarrow
      : wide
        ? bridges.verticalWide
        : bridges.verticalNarrow;
  if (cells.length === 0) return;
  const cell = cells[hashTile(Math.floor(edge.midX), Math.floor(edge.midY)) % cells.length]!;
  const sortY = Math.max(
    a.entity.position.y + a.def.collisionBox[1][1],
    b.entity.position.y + b.def.collisionBox[1][1],
  );
  const sortX = (a.entity.position.x + b.entity.position.x) / 2;
  emitCell(
    cell,
    edge.midX,
    edge.midY,
    db,
    a.entity.entity_number,
    nextSub(),
    sortY,
    sortX,
    commands,
  );

  // Crossing when both H and V neighbors exist is handled by multiple pair calls;
  // additionally place crossing when the shared corner has 4-way occupancy.
}

/** @internal exported for tests */
export const _cargoBayConnectionsTest = {
  occupancyMask,
  sharedEdge,
  footprintCells,
  CONNECTABLE_PROTOS,
  CONNECTION_GRID_SIZE,
  NEIGHBOR8,
};
