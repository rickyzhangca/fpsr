import type { Blueprint, BlueprintEntity } from "../types/blueprint.js";
import type { EntityKind, EntityRenderDef, RenderDb } from "../types/render-db.js";
import {
  DIR_DELTA,
  cardinalDirection,
  dir16ToIndex,
  opposite,
  posKey,
  rotateOffset,
} from "./shared.js";

/**
 * Verified against belt_animation_set defaults: X=east_index-1=0,
 * west_index-1=1, north_index-1=2, south_index-1=3.
 * Prototype defaults are 1-based; values here are 0-based rows into the 20-slot table.
 */
export const BELT_STRAIGHT_INDEX: Record<0 | 4 | 8 | 12, number> = {
  0: 2,
  4: 0,
  8: 3,
  12: 1,
};

/** Curve when the sole feeder is on the belt's right (FBE "right"). */
export const BELT_CURVE_RIGHT: Record<0 | 4 | 8 | 12, number> = {
  0: 4, // east_to_north
  4: 8, // south_to_east
  8: 11, // west_to_south
  12: 7, // north_to_west
};

/** Curve when the sole feeder is on the belt's left (FBE "left"). */
export const BELT_CURVE_LEFT: Record<0 | 4 | 8 | 12, number> = {
  0: 6, // west_to_north
  4: 5, // north_to_east
  8: 9, // east_to_south
  12: 10, // south_to_west
};

/**
 * Starting-cap row for a belt facing `dir`.
 * FBE maps north-facing → starting_south (back-edge art), etc.
 */
export const BELT_START_INDEX: Record<0 | 4 | 8 | 12, number> = {
  0: 12, // starting_south
  4: 14, // starting_west
  8: 16, // starting_north
  12: 18, // starting_east
};

/** Ending-cap row for a belt facing `dir`. */
export const BELT_END_INDEX: Record<0 | 4 | 8 | 12, number> = {
  0: 17, // ending_north
  4: 19, // ending_east
  8: 13, // ending_south
  12: 15, // ending_west
};

const BELT_CONNECTABLE: ReadonlySet<EntityKind> = new Set([
  "belt",
  "underground-belt",
  "splitter",
  "loader",
]);

/**
 * UG/loader structure sheets pack horizontal columns N,E,S,W (same as direction4).
 * Kept as an explicit table so distill/resolve stay aligned if packing changes.
 * Outputs use the opposite flow direction so paired hoods face away from each other
 * (same-column direction_in/direction_out art faces the same way).
 */
export const UG_STRUCTURE_INDEX: readonly [number, number, number, number] = [0, 1, 2, 3];

/** Structure column for UG/loader hood sprites (object layer only). */
export function undergroundStructureIndex(
  direction: number,
  type: BlueprintEntity["type"],
): number {
  const dir4 = dir16ToIndex(direction, "direction4");
  const structureDir4 = type === "output" ? (dir4 + 2) % 4 : dir4;
  return UG_STRUCTURE_INDEX[structureDir4] ?? structureDir4;
}

export interface BeltOccupant {
  entity: BlueprintEntity;
  def: EntityRenderDef;
}

/**
 * Map every occupied tile-center to belt-connectable entities on that tile.
 * Splitters cover two tiles (tileSize [2,1] = long × short; 1×2 when facing N/S).
 */
export function buildBeltTileIndex(
  entities: BlueprintEntity[],
  db: RenderDb,
): Map<string, BeltOccupant[]> {
  const index = new Map<string, BeltOccupant[]>();

  const add = (x: number, y: number, occ: BeltOccupant) => {
    const key = posKey(x, y);
    const list = index.get(key);
    if (list) list.push(occ);
    else index.set(key, [occ]);
  };

  for (const entity of entities) {
    const def = db.entities[entity.name];
    if (!def || !BELT_CONNECTABLE.has(def.kind)) continue;
    const occ: BeltOccupant = { entity, def };

    if (def.kind === "splitter") {
      const dir = cardinalDirection(entity.direction);
      const raw = def.data?.tileSize;
      // tileSize is the north-facing footprint (wide × short). N/S stay [2,1];
      // E/W rotate to [1,2] — matches Factorio collision and structure art.
      const baseW = raw?.[0] ?? 2;
      const baseH = raw?.[1] ?? 1;
      const w = dir === 0 || dir === 8 ? baseW : baseH;
      const h = dir === 0 || dir === 8 ? baseH : baseW;
      const cx = entity.position.x;
      const cy = entity.position.y;
      for (let ix = 0; ix < w; ix++) {
        for (let iy = 0; iy < h; iy++) {
          add(cx - w / 2 + 0.5 + ix, cy - h / 2 + 0.5 + iy, occ);
        }
      }
    } else {
      add(entity.position.x, entity.position.y, occ);
    }
  }
  return index;
}

/**
 * Neighbors in absolute NESW order, then rotated so index 0 = ahead of `dir`.
 * Matches FBE getNeighbourData + splice(direction/4): [ahead, right, behind, left].
 */
function rotatedNeighbors(
  beltIndex: Map<string, BeltOccupant[]>,
  x: number,
  y: number,
  dir: 0 | 4 | 8 | 12,
): (BeltOccupant | undefined)[] {
  const abs: (BeltOccupant | undefined)[] = [
    beltIndex.get(posKey(x, y - 1))?.[0],
    beltIndex.get(posKey(x + 1, y))?.[0],
    beltIndex.get(posKey(x, y + 1))?.[0],
    beltIndex.get(posKey(x - 1, y))?.[0],
  ];
  const start = dir / 4;
  return [abs[start], abs[(start + 1) % 4], abs[(start + 2) % 4], abs[(start + 3) % 4]];
}

/**
 * True when the occupant faces toward the belt (FBE C2).
 * Underground/loader inputs never count as feeders.
 */
function facesTowardBelt(occ: BeltOccupant | undefined, absRelDir: 0 | 4 | 8 | 12): boolean {
  if (!occ) return false;
  if (
    (occ.def.kind === "underground-belt" || occ.def.kind === "loader") &&
    occ.entity.type === "input"
  ) {
    return false;
  }
  return cardinalDirection(occ.entity.direction) === opposite(absRelDir);
}

export function beltCurveIndex(
  entity: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
): number {
  const dir = cardinalDirection(entity.direction);
  const { x, y } = entity.position;
  const C = rotatedNeighbors(beltIndex, x, y, dir);
  const absDirs: (0 | 4 | 8 | 12)[] = [
    dir,
    ((dir + 4) % 16) as 0 | 4 | 8 | 12,
    opposite(dir),
    ((dir + 12) % 16) as 0 | 4 | 8 | 12,
  ];
  const C2 = C.map((occ, i) => {
    const abs = absDirs[i];
    return abs !== undefined && facesTowardBelt(occ, abs) ? occ : undefined;
  });

  // Exactly one perpendicular input and no input from behind → curve.
  if (C2[1] && !C2[3] && !C2[2]) return BELT_CURVE_RIGHT[dir];
  if (C2[3] && !C2[1] && !C2[2]) return BELT_CURVE_LEFT[dir];
  return BELT_STRAIGHT_INDEX[dir];
}

/**
 * Circuit-connector topology variation for a transport belt (0–6).
 * Factorio order: X, H, V, SE, SW, NE, NW.
 *
 * Uses the same neighbor model as beltCurveIndex. Both perpendicular feeders → X;
 * straight belts → H (E/W) or V (N/S); curves map via belt animation corner names.
 */
export function beltCircuitConnectorVariation(
  entity: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
): number {
  const dir = cardinalDirection(entity.direction);
  const { x, y } = entity.position;
  const C = rotatedNeighbors(beltIndex, x, y, dir);
  const absDirs: (0 | 4 | 8 | 12)[] = [
    dir,
    ((dir + 4) % 16) as 0 | 4 | 8 | 12,
    opposite(dir),
    ((dir + 12) % 16) as 0 | 4 | 8 | 12,
  ];
  const C2 = C.map((occ, i) => {
    const abs = absDirs[i];
    return abs !== undefined && facesTowardBelt(occ, abs) ? occ : undefined;
  });

  // Both sides feeding (T / cross) → X.
  if (C2[1] && C2[3]) return 0;

  if (C2[1] && !C2[3] && !C2[2]) {
    return BELT_CURVE_ANIM_TO_CONNECTOR[BELT_CURVE_RIGHT[dir]] ?? 0;
  }
  if (C2[3] && !C2[1] && !C2[2]) {
    return BELT_CURVE_ANIM_TO_CONNECTOR[BELT_CURVE_LEFT[dir]] ?? 0;
  }

  // Straight: H for east/west, V for north/south.
  return dir === 4 || dir === 12 ? 1 : 2;
}

/**
 * Map belt animation curve row → connector variation (SE=3, SW=4, NE=5, NW=6).
 * Animation names like east_to_north share the NE corner of the tile.
 */
const BELT_CURVE_ANIM_TO_CONNECTOR: Record<number, number> = {
  4: 5, // east_to_north → NE
  5: 5, // north_to_east → NE
  6: 6, // west_to_north → NW
  7: 6, // north_to_west → NW
  8: 3, // south_to_east → SE
  9: 3, // east_to_south → SE
  10: 4, // south_to_west → SW
  11: 4, // west_to_south → SW
};

/** Back-patch row for connector variation: straights/X → 0; SE/SW → 1; NE/NW → 2. */
export function beltConnectorBackPatchIndex(variation: number): number {
  if (variation <= 2) return 0;
  if (variation <= 4) return 1;
  return 2;
}

/**
 * Belt-reader sheet layout (Factorio binary validation):
 * - bands (rows): StraightSolidBand=0, StraightOpenBand=1, CurvedSolidBand=2, Ending=3
 * - frames: North=0, East=1, South=2, West=3 (tile-edge pieces)
 */
export const BELT_READER_BAND = {
  solid: 0,
  open: 1,
  curved: 2,
  ending: 3,
} as const;

export const BELT_READER_FRAME = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
} as const;

const BELT_READER_FRAME_FROM_DIR: Record<0 | 4 | 8 | 12, number> = {
  0: BELT_READER_FRAME.north,
  4: BELT_READER_FRAME.east,
  8: BELT_READER_FRAME.south,
  12: BELT_READER_FRAME.west,
};

/** Map circuit-connector corner (SE=3,SW=4,NE=5,NW=6) → reader frame N/E/S/W. */
const CONNECTOR_CORNER_TO_READER_FRAME: Record<number, number> = {
  5: BELT_READER_FRAME.north, // NE — arc along north+east
  3: BELT_READER_FRAME.east, // SE
  4: BELT_READER_FRAME.south, // SW
  6: BELT_READER_FRAME.west, // NW — arc along west+north
};

export type BeltReaderSlot = {
  band: number;
  frame: number;
  /** Mirror Ending across the open tip so the outer half of the fancy cap appears. */
  flipX?: boolean;
  flipY?: boolean;
  /**
   * Extra tile-space shift on top of the sprite variant shift.
   * Used to hang the mirrored Ending half past the open tip.
   */
  shift?: [number, number];
};

/**
 * Ending cells are authored as inward hooks flush to the open edge (no outer
 * half). Mirror across that edge into the adjacent tile so the cap closes.
 */
function endingMirrorSlot(frame: number): BeltReaderSlot {
  switch (frame) {
    case BELT_READER_FRAME.east:
      return { band: BELT_READER_BAND.ending, frame, flipX: true, shift: [1, 0] };
    case BELT_READER_FRAME.west:
      return { band: BELT_READER_BAND.ending, frame, flipX: true, shift: [-1, 0] };
    case BELT_READER_FRAME.north:
      return { band: BELT_READER_BAND.ending, frame, flipY: true, shift: [0, -1] };
    case BELT_READER_FRAME.south:
      return { band: BELT_READER_BAND.ending, frame, flipY: true, shift: [0, 1] };
    default:
      return { band: BELT_READER_BAND.ending, frame };
  }
}

/**
 * Which belt-reader sheet cells to paint for one belt on an entire_belt_hold line.
 * Straights: SolidBand on both long-side edges; open line ends also get Ending
 * short-edge caps so the rail "grabs" the belt tip (in-game).
 * Curves: one CurvedSolidBand corner frame.
 *
 * Ending sprites are inward hooks flush to the tip edge — also emit a mirrored
 * copy one tile past the tip so the outer half of the fancy cap appears.
 */
export function beltReaderSlots(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  beltIndex: Map<string, BeltOccupant[]>,
  readerEntities: Set<number>,
): BeltReaderSlot[] {
  const dir = cardinalDirection(entity.direction);
  const curve = beltCurveIndex(entity, beltIndex);
  const isCurve = curve >= 4 && curve <= 11;

  if (isCurve) {
    const corner = BELT_CURVE_ANIM_TO_CONNECTOR[curve] ?? 5;
    const frame = CONNECTOR_CORNER_TO_READER_FRAME[corner] ?? BELT_READER_FRAME.north;
    return [{ band: BELT_READER_BAND.curved, frame }];
  }

  // Long sides: E/W-facing → N+S; N/S-facing → E+W.
  const sides =
    dir === 4 || dir === 12
      ? [BELT_READER_FRAME.north, BELT_READER_FRAME.south]
      : [BELT_READER_FRAME.east, BELT_READER_FRAME.west];

  const slots: BeltReaderSlot[] = sides.map((frame) => ({
    band: BELT_READER_BAND.solid,
    frame,
  }));

  // Terminus caps: Ending frame + mirrored outer half past the open tip
  // (through UGs still counts as connected).
  const forward = nextOnLine(entity, def, dir, beltIndex);
  const backward = nextOnLine(entity, def, opposite(dir), beltIndex);
  const forwardInLine = forward != null && readerEntities.has(forward.entity_number);
  const backwardInLine = backward != null && readerEntities.has(backward.entity_number);
  const pushEnding = (frame: number) => {
    slots.push({ band: BELT_READER_BAND.ending, frame });
    slots.push(endingMirrorSlot(frame));
  };
  if (!forwardInLine) pushEnding(BELT_READER_FRAME_FROM_DIR[dir]);
  if (!backwardInLine) pushEnding(BELT_READER_FRAME_FROM_DIR[opposite(dir)]);

  return slots;
}

/** `defines.control_behavior.transport_belt.content_read_mode.entire_belt_hold` */
export const BELT_CONTENT_READ_ENTIRE = 2;

/** Enable/disable (write/output) — horizontal red/green LEDs on the belt cage. */
export function isBeltCircuitOutputEnabled(entity: BlueprintEntity): boolean {
  const cb = entity.control_behavior;
  if (!cb) return false;
  // 2.x blueprint field; accept legacy enable_disable if present
  return cb.circuit_enabled === true || cb.circuit_enable_disable === true;
}

/** Read belt contents (input) — vertical blue LED on the belt cage. */
export function isBeltCircuitInputEnabled(entity: BlueprintEntity): boolean {
  return entity.control_behavior?.circuit_read_hand_contents === true;
}

/**
 * Connector-frame state used by Factorio's four-frame belt connector sheet.
 * The frames are a behavior bitmask, not belt directions:
 * none=0, enable/output=1, read/input=2, both=3.
 */
export function beltCircuitConnectorFrame(entity: BlueprintEntity): number {
  return (isBeltCircuitOutputEnabled(entity) ? 1 : 0) | (isBeltCircuitInputEnabled(entity) ? 2 : 0);
}

function isEntireBeltHold(entity: BlueprintEntity): boolean {
  const cb = entity.control_behavior;
  if (!cb || cb.circuit_read_hand_contents !== true) return false;
  return cb.circuit_contents_read_mode === BELT_CONTENT_READ_ENTIRE;
}

/**
 * Belts that should show whole-belt-reader skirts: the wired reader with
 * entire_belt_hold, plus every transport-belt and underground-belt on its
 * contiguous line (through UGs; stops at splitters / side-loads).
 */
export function collectBeltReaderEntities(
  bp: Blueprint,
  db: RenderDb,
  beltIndex: Map<string, BeltOccupant[]>,
): Set<number> {
  const out = new Set<number>();
  const entities = bp.entities ?? [];
  for (const e of entities) {
    const def = db.entities[e.name];
    if (!def || def.kind !== "belt") continue;
    if (!isEntireBeltHold(e)) continue;
    for (const id of walkTransportLine(e, beltIndex, db)) out.add(id);
  }
  return out;
}

/**
 * Walk a transport line from `start` in both directions.
 * Includes plain belts and underground belts (skirts draw under UG hoods);
 * UG also bridges the walk. Stops at splitters / true side-loads.
 */
function walkTransportLine(
  start: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
  db: RenderDb,
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const queue: BlueprintEntity[] = [start];

  while (queue.length > 0) {
    const cur = queue.pop();
    if (!cur || seen.has(cur.entity_number)) continue;
    seen.add(cur.entity_number);
    const def = db.entities[cur.name];
    if (!def) continue;

    if (def.kind === "belt" || def.kind === "underground-belt") {
      ids.push(cur.entity_number);
    }

    if (def.kind === "belt" || def.kind === "underground-belt") {
      const dir = cardinalDirection(cur.direction);
      const forward = nextOnLine(cur, def, dir, beltIndex);
      const backward = nextOnLine(cur, def, opposite(dir), beltIndex);
      if (forward) queue.push(forward);
      if (backward) queue.push(backward);
      // Curve corner: also walk onto the perpendicular feeder belt.
      if (def.kind === "belt") {
        const feeder = curvePerpendicularFeeder(cur, beltIndex);
        if (feeder) queue.push(feeder);
      }
    }
  }
  return ids;
}

/**
 * If `entity` is a curve, the single perpendicular belt feeding into it.
 */
function curvePerpendicularFeeder(
  entity: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
): BlueprintEntity | undefined {
  const dir = cardinalDirection(entity.direction);
  const { x, y } = entity.position;
  const C = rotatedNeighbors(beltIndex, x, y, dir);
  const absDirs: (0 | 4 | 8 | 12)[] = [
    dir,
    ((dir + 4) % 16) as 0 | 4 | 8 | 12,
    opposite(dir),
    ((dir + 12) % 16) as 0 | 4 | 8 | 12,
  ];
  const C2 = C.map((occ, i) => {
    const abs = absDirs[i];
    return abs !== undefined && facesTowardBelt(occ, abs) ? occ : undefined;
  });
  if (C2[1] && !C2[3] && !C2[2]) return C2[1]?.entity;
  if (C2[3] && !C2[1] && !C2[2]) return C2[3]?.entity;
  return undefined;
}

/**
 * Next entity along a transport line in absolute direction `stepDir`.
 * Skips through underground pairs; rejects splitters / true side-loads.
 * Allows stepping onto a curve when we are that curve's perpendicular feeder.
 */
function nextOnLine(
  cur: BlueprintEntity,
  curDef: EntityRenderDef,
  stepDir: 0 | 4 | 8 | 12,
  beltIndex: Map<string, BeltOccupant[]>,
): BlueprintEntity | undefined {
  if (curDef.kind === "underground-belt") {
    const facing = cardinalDirection(cur.direction);
    const isOutput = cur.type === "output";
    // Into the tunnel → jump to partner.
    if ((!isOutput && stepDir === facing) || (isOutput && stepDir === opposite(facing))) {
      return findUndergroundPartner(cur, beltIndex) ?? undefined;
    }
    // Out of the open side → neighbor belt/UG in stepDir (fall through).
  }

  const [dx, dy] = DIR_DELTA[stepDir];
  const occupants = beltIndex.get(posKey(cur.position.x + dx, cur.position.y + dy));
  if (!occupants?.length) return undefined;

  for (const occ of occupants) {
    if (occ.def.kind === "splitter") return undefined; // line breaks
    if (occ.def.kind === "belt" || occ.def.kind === "underground-belt") {
      const od = cardinalDirection(occ.entity.direction);
      if (od === stepDir || od === opposite(stepDir)) return occ.entity;
      // Non-collinear: only OK when the neighbor is a curve and we are its feeder
      // (same transport line around the corner). True side-loads stop here.
      if (occ.def.kind === "belt") {
        const feeder = curvePerpendicularFeeder(occ.entity, beltIndex);
        if (feeder && feeder.entity_number === cur.entity_number) return occ.entity;
      }
      return undefined;
    }
  }
  return undefined;
}

function findUndergroundPartner(
  ug: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
): BlueprintEntity | null {
  const facing = cardinalDirection(ug.direction);
  const isOutput = ug.type === "output";
  // Search along the tunnel: from input, forward; from output, backward.
  const step = isOutput ? opposite(facing) : facing;
  const [dx, dy] = DIR_DELTA[step];
  const maxDist = 10; // vanilla max UG distance is tier-dependent; 10 covers turbo
  for (let i = 1; i <= maxDist; i++) {
    const x = ug.position.x + dx * i;
    const y = ug.position.y + dy * i;
    const occupants = beltIndex.get(posKey(x, y));
    if (!occupants) continue;
    for (const occ of occupants) {
      if (occ.def.kind !== "underground-belt") continue;
      if (occ.entity.name !== ug.name) continue;
      if (cardinalDirection(occ.entity.direction) !== facing) continue;
      const partnerIsOutput = occ.entity.type === "output";
      if (partnerIsOutput === isOutput) continue; // need opposite type
      return occ.entity;
    }
  }
  return null;
}

export function hasBeltFeederAt(
  x: number,
  y: number,
  dir: 0 | 4 | 8 | 12,
  beltIndex: Map<string, BeltOccupant[]>,
): boolean {
  const C = rotatedNeighbors(beltIndex, x, y, dir);
  const absDirs: (0 | 4 | 8 | 12)[] = [
    dir,
    ((dir + 4) % 16) as 0 | 4 | 8 | 12,
    opposite(dir),
    ((dir + 12) % 16) as 0 | 4 | 8 | 12,
  ];
  for (let i = 1; i < 4; i++) {
    const abs = absDirs[i];
    if (abs !== undefined && facesTowardBelt(C[i], abs)) return true;
  }
  return false;
}

export function hasBeltFeeder(
  entity: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
): boolean {
  return hasBeltFeederAt(
    entity.position.x,
    entity.position.y,
    cardinalDirection(entity.direction),
    beltIndex,
  );
}

/**
 * True when something feeds the UG/loader open side (behind the facing).
 * Side-loads do not seal the open half — only a behind feeder suppresses the
 * start wrap cap.
 */
export function hasOpenSideFeeder(
  entity: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
): boolean {
  const dir = cardinalDirection(entity.direction);
  const { x, y } = entity.position;
  const C = rotatedNeighbors(beltIndex, x, y, dir);
  return facesTowardBelt(C[2], opposite(dir));
}

/**
 * True when a belt-connectable ahead accepts this belt's output
 * (no ending cap). Belts and splitters always accept; UG/loader inputs
 * facing the same direction accept; UG/loader outputs do not.
 */
export function hasBeltConsumerAt(
  x: number,
  y: number,
  dir: 0 | 4 | 8 | 12,
  beltIndex: Map<string, BeltOccupant[]>,
): boolean {
  const [dx, dy] = DIR_DELTA[dir];
  const occupants = beltIndex.get(posKey(x + dx, y + dy));
  if (!occupants) return false;

  for (const occ of occupants) {
    if (occ.def.kind === "belt" || occ.def.kind === "splitter") return true;
    if (occ.def.kind === "underground-belt" || occ.def.kind === "loader") {
      if (occ.entity.type === "output") continue;
      if (cardinalDirection(occ.entity.direction) === dir) return true;
    }
  }
  return false;
}

export function hasBeltConsumer(
  entity: BlueprintEntity,
  beltIndex: Map<string, BeltOccupant[]>,
): boolean {
  return hasBeltConsumerAt(
    entity.position.x,
    entity.position.y,
    cardinalDirection(entity.direction),
    beltIndex,
  );
}

/** Full-tile shift behind (start) / ahead (end) for belt caps — matches FBE. */
export function beltCapShift(dir: 0 | 4 | 8 | 12, kind: "start" | "end"): [number, number] {
  // FBE: start = rotate([0, 1], dir), end = rotate([0, -1], dir).
  return kind === "start" ? rotateOffset(0, 1, dir) : rotateOffset(0, -1, dir);
}
