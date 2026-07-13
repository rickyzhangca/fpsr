/**
 * Rolling-stock coupling chain overlay: green joint circles + straight segments
 * along connected wagons (Factorio attach/coupling visualization).
 */

import { trainWheelShifts } from "./resolve.js";
import type {
  Blueprint,
  BlueprintEntity,
  BlueprintRollingStockConnection,
} from "./types/blueprint.js";
import type { EntityRenderDef } from "./types/render-db.js";

/** Default Factorio RollingStock connection_distance when not distilled. */
export const DEFAULT_CONNECTION_DISTANCE = 3;
/** Default Factorio RollingStock joint_distance when not distilled. */
export const DEFAULT_JOINT_DISTANCE = 4;
/** Hollow joint circle radius in tiles — segments stop at this edge. */
export const TRAIN_CHAIN_JOINT_RADIUS = 0.3;

/** Tolerance when inferring couplings from joint proximity (tiles). */
const COUPLE_TOLERANCE = 0.25;

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export interface TrainJointPoints {
  /** Joint in the +orientation direction (±joint/2). */
  front: [number, number];
  /** Joint in the −orientation direction. */
  back: [number, number];
}

export interface TrainChainGeometry {
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  joints: { x: number; y: number }[];
}

function jointDistanceOf(def: EntityRenderDef): number {
  const j = def.data?.jointDistance;
  return typeof j === "number" && j > 0 ? j : DEFAULT_JOINT_DISTANCE;
}

function connectionDistanceOf(def: EntityRenderDef): number {
  const c = def.data?.connectionDistance;
  return typeof c === "number" && c > 0 ? c : DEFAULT_CONNECTION_DISTANCE;
}

/**
 * World-space front/back joint positions for a rolling-stock entity.
 * Matches bogie placement from `trainWheelShifts` (index 0 = front/+half).
 */
export function trainJointWorldPoints(
  entity: BlueprintEntity,
  jointDistance: number,
): TrainJointPoints {
  const bogies = trainWheelShifts(entity.orientation ?? 0, jointDistance);
  const front = bogies[0]!;
  const back = bogies[1]!;
  return {
    front: [round4(entity.position.x + front.shift[0]), round4(entity.position.y + front.shift[1])],
    back: [round4(entity.position.x + back.shift[0]), round4(entity.position.y + back.shift[1])],
  };
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function jointKey(x: number, y: number): string {
  return `${Math.round(x * 1e4) / 1e4},${Math.round(y * 1e4) / 1e4}`;
}

function addSegment(
  segments: { x1: number; y1: number; x2: number; y2: number }[],
  seen: Set<string>,
  a: [number, number],
  b: [number, number],
  /** Inset each end by this many tiles so the stroke meets circle edges. */
  endInset = 0,
): void {
  const k1 = `${jointKey(a[0], a[1])}|${jointKey(b[0], b[1])}`;
  const k2 = `${jointKey(b[0], b[1])}|${jointKey(a[0], a[1])}`;
  if (seen.has(k1) || seen.has(k2)) return;
  seen.add(k1);

  let x1 = a[0];
  let y1 = a[1];
  let x2 = b[0];
  let y2 = b[1];
  if (endInset > 0) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len <= endInset * 2) return; // too short to draw between circles
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    x1 = round4(x1 + ux * endInset);
    y1 = round4(y1 + uy * endInset);
    x2 = round4(x2 - ux * endInset);
    y2 = round4(y2 - uy * endInset);
  }
  segments.push({ x1, y1, x2, y2 });
}

function addJoint(
  joints: { x: number; y: number }[],
  seen: Set<string>,
  p: [number, number],
): void {
  const k = jointKey(p[0], p[1]);
  if (seen.has(k)) return;
  seen.add(k);
  joints.push({ x: p[0], y: p[1] });
}

type StockSide = "front" | "back";

interface CouplingEdge {
  a: number;
  aSide: StockSide;
  b: number;
  bSide: StockSide;
}

function sideOfNeighbor(
  links: Map<number, { front?: number; back?: number }>,
  neighbor: number,
  stock: number,
  fallback: StockSide,
): StockSide {
  const n = links.get(neighbor);
  if (n?.front === stock) return "front";
  if (n?.back === stock) return "back";
  return fallback;
}

function parseStockConnections(
  raw: BlueprintRollingStockConnection[] | undefined,
  trainNums: Set<number>,
): CouplingEdge[] {
  if (!raw?.length) return [];
  const links = new Map<number, { front?: number; back?: number }>();
  for (const entry of raw) {
    if (!entry || typeof entry.stock !== "number") continue;
    if (!trainNums.has(entry.stock)) continue;
    const cur = links.get(entry.stock) ?? {};
    if (typeof entry.front === "number") cur.front = entry.front;
    if (typeof entry.back === "number") cur.back = entry.back;
    links.set(entry.stock, cur);
  }

  const edges: CouplingEdge[] = [];
  const seen = new Set<string>();
  for (const [stock, sides] of links) {
    for (const aSide of ["front", "back"] as const) {
      const neighbor = sides[aSide];
      if (typeof neighbor !== "number" || !trainNums.has(neighbor) || neighbor === stock) {
        continue;
      }
      const lo = Math.min(stock, neighbor);
      const hi = Math.max(stock, neighbor);
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Prefer the neighbor's declared side; if missing, assume opposite joint.
      const fallback: StockSide = aSide === "front" ? "back" : "front";
      const bSide = sideOfNeighbor(links, neighbor, stock, fallback);
      edges.push({ a: stock, aSide, b: neighbor, bSide });
    }
  }
  return edges;
}

/**
 * Infer couplings when `stock_connections` is absent: facing joints within
 * connection_distance ± tolerance, orientations aligned or opposite.
 */
function inferCouplings(
  trains: { entity: BlueprintEntity; def: EntityRenderDef }[],
  jointsByNum: Map<number, TrainJointPoints>,
): CouplingEdge[] {
  const edges: CouplingEdge[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < trains.length; i++) {
    const a = trains[i]!;
    const ja = jointsByNum.get(a.entity.entity_number);
    if (!ja) continue;
    const connA = connectionDistanceOf(a.def);

    for (let j = i + 1; j < trains.length; j++) {
      const b = trains[j]!;
      const jb = jointsByNum.get(b.entity.entity_number);
      if (!jb) continue;
      const connB = connectionDistanceOf(b.def);
      const expected = (connA + connB) / 2;

      const candidates: { aSide: StockSide; bSide: StockSide; d: number }[] = [
        { aSide: "front", bSide: "front", d: dist(ja.front, jb.front) },
        { aSide: "front", bSide: "back", d: dist(ja.front, jb.back) },
        { aSide: "back", bSide: "front", d: dist(ja.back, jb.front) },
        { aSide: "back", bSide: "back", d: dist(ja.back, jb.back) },
      ];

      let best: (typeof candidates)[number] | undefined;
      for (const c of candidates) {
        if (Math.abs(c.d - expected) > COUPLE_TOLERANCE) continue;
        if (!best || c.d < best.d) best = c;
      }
      if (!best) continue;

      const lo = Math.min(a.entity.entity_number, b.entity.entity_number);
      const hi = Math.max(a.entity.entity_number, b.entity.entity_number);
      const key = `${lo}-${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        a: a.entity.entity_number,
        aSide: best.aSide,
        b: b.entity.entity_number,
        bSide: best.bSide,
      });
    }
  }
  return edges;
}

function pointOf(joints: TrainJointPoints, side: StockSide): [number, number] {
  return side === "front" ? joints.front : joints.back;
}

/**
 * Build train-chain overlay geometry for all coupled rolling stock in a blueprint.
 *
 * Draws hollow circles only at coupled joints (free ends omitted), and straight
 * segments between those facing joints. Segment endpoints are inset to the
 * circle perimeter so strokes meet the rings instead of crossing through them.
 *
 * Isolated single wagons with no neighbors are omitted.
 */
export function buildTrainChainGeometry(
  bp: Blueprint,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
): TrainChainGeometry | null {
  const trains: { entity: BlueprintEntity; def: EntityRenderDef }[] = [];
  for (const entry of byNumber.values()) {
    if (entry.def.kind === "train") trains.push(entry);
  }
  if (trains.length === 0) return null;

  const trainNums = new Set(trains.map((t) => t.entity.entity_number));
  const jointsByNum = new Map<number, TrainJointPoints>();
  for (const t of trains) {
    jointsByNum.set(
      t.entity.entity_number,
      trainJointWorldPoints(t.entity, jointDistanceOf(t.def)),
    );
  }

  let edges = parseStockConnections(bp.stock_connections, trainNums);
  if (edges.length === 0) {
    edges = inferCouplings(trains, jointsByNum);
  }
  if (edges.length === 0) return null;

  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const joints: { x: number; y: number }[] = [];
  const segSeen = new Set<string>();
  const jointSeen = new Set<string>();

  // Only joints that participate in a coupling (skip free ends).
  for (const e of edges) {
    const ja = jointsByNum.get(e.a);
    const jb = jointsByNum.get(e.b);
    if (!ja || !jb) continue;
    const aPt = pointOf(ja, e.aSide);
    const bPt = pointOf(jb, e.bSide);
    addJoint(joints, jointSeen, aPt);
    addJoint(joints, jointSeen, bPt);
    addSegment(segments, segSeen, aPt, bPt, TRAIN_CHAIN_JOINT_RADIUS);
  }

  if (segments.length === 0 && joints.length === 0) return null;
  return { segments, joints };
}
