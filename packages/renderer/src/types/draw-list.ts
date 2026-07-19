/**
 * The draw-list IR: the fully-resolved, ordered list of drawing commands the
 * planner emits and the canvas backend executes. JSON-serializable; this is
 * the Tier-2 snapshot surface.
 *
 * All geometry is in tile units (see https://fpsr-docs.fprints.xyz/project/architecture).
 */

import type { FrameId, RenderLayerName } from "./render-db.js";

/**
 * Full Factorio `RenderLayer` enum (lowest → highest).
 * Source: https://lua-api.factorio.com/latest/types/RenderLayer.html
 * (same data as Factorio.app `doc-html/prototype-api.json`, 2.1.11).
 * Values are the enum indices; order is the contract.
 */
export const FACTORIO_RENDER_LAYERS = {
  zero: 0,
  "background-transitions": 1,
  "under-tiles": 2,
  decals: 3,
  "above-tiles": 4,
  "ground-layer-1": 5,
  "ground-layer-2": 6,
  "ground-layer-3": 7,
  "ground-layer-4": 8,
  "ground-layer-5": 9,
  "lower-radius-visualization": 10,
  "radius-visualization": 11,
  "transport-belt-integration": 12,
  resource: 13,
  "building-smoke": 14,
  "rail-stone-path-lower": 15,
  "rail-stone-path": 16,
  "rail-tie": 17,
  decorative: 18,
  "ground-patch": 19,
  "ground-patch-higher": 20,
  "ground-patch-higher2": 21,
  "rail-chain-signal-metal": 22,
  "rail-screw": 23,
  "rail-metal": 24,
  remnants: 25,
  floor: 26,
  "transport-belt": 27,
  "transport-belt-endings": 28,
  "floor-mechanics-under-corpse": 29,
  corpse: 30,
  "floor-mechanics": 31,
  item: 32,
  "transport-belt-reader": 33,
  "lower-object": 34,
  "transport-belt-circuit-connector": 35,
  "lower-object-above-shadow": 36,
  "lower-object-overlay": 37,
  "object-under": 38,
  object: 39,
  "cargo-hatch": 40,
  "higher-object-under": 41,
  "higher-object-above": 42,
  "train-stop-top": 43,
  "item-in-inserter-hand": 44,
  "above-inserters": 45,
  wires: 46,
  "under-elevated": 47,
  "elevated-rail-stone-path-lower": 48,
  "elevated-rail-stone-path": 49,
  "elevated-rail-tie": 50,
  "elevated-rail-screw": 51,
  "elevated-rail-metal": 52,
  "elevated-lower-object": 53,
  "elevated-object": 54,
  "elevated-higher-object": 55,
  "fluid-visualization": 56,
  "wires-above": 57,
  "entity-info-icon": 58,
  "entity-info-icon-above": 59,
  explosion: 60,
  projectile: 61,
  smoke: 62,
  "air-object": 63,
  "air-entity-info-icon": 64,
  "light-effect": 65,
  "selection-box": 66,
  "higher-selection-box": 67,
  "collision-selection-box": 68,
  arrow: 69,
  cursor: 70,
} as const;

/**
 * fpsr-only names (not in Factorio's enum) and legacy aliases.
 * Aliases share the official index of the Factorio name they stand for.
 */
const FPSR_RENDER_LAYERS = {
  /** ≈ `background-transitions` */
  "tile-transition": 1,
  /** ≈ `under-tiles` */
  "ground-tile": 2,
  "water-tile": 2,
  /** alias of `rail-tie` */
  "rail-ties": 17,
  /** Dedicated `draw_as_shadow` pass (no Factorio RenderLayer for this) */
  shadow: 37,
  /** alias of `elevated-rail-tie` */
  "elevated-rail-ties": 50,
  /** alias of `entity-info-icon` */
  icons: 58,
} as const;

export const RENDER_LAYERS: Record<RenderLayerName, number> = {
  ...FACTORIO_RENDER_LAYERS,
  ...FPSR_RENDER_LAYERS,
};

interface DrawCmdBase {
  /** Numeric layer from RENDER_LAYERS. */
  layer: number;
  /** Y-sort key within the layer (entity collision-box bottom; 0 for non-object layers). */
  sortY: number;
  /**
   * X-sort key within the layer (entity position.x for object layers; 0 otherwise).
   * Same-Y neighbors paint west→east so baked hood shadows don’t cover eastern sprites.
   */
  sortX: number;
  /** Owning entity_number (0 for tiles/background), for stable sort + debugging. */
  entity: number;
  /** Intra-entity sub-layer index. */
  sub: number;
}

export interface RectCmd extends DrawCmdBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: [number, number, number, number];
}

export interface SpriteCmd extends DrawCmdBase {
  kind: "sprite";
  frame: FrameId;
  x: number;
  y: number;
  w: number;
  h: number;
  tint?: [number, number, number, number];
  shadow?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  /** Clockwise degrees around the sprite center. */
  rotation?: number;
  /**
   * Continue a small interior band beyond the authored destination. Legacy
   * lower rail-bed sprites have sparse alpha-feathered ends that can otherwise
   * expose terrain where straight and curved pieces meet.
   */
  seamBleed?: {
    top?: true;
    right?: true;
    bottom?: true;
    left?: true;
  };
  /**
   * Optional sub-rect within the untrimmed source sprite (`FrameMeta.sw`×`sh`,
   * pixels). When set, `x`/`y`/`w`/`h` are the destination rect for this slice.
   */
  src?: { x: number; y: number; w: number; h: number };
  /**
   * Optional destination-space clip rect (tile units, same space as x/y/w/h).
   * Backend applies before drawing; used for UG/loader belt underlay halves.
   */
  clip?: { x: number; y: number; w: number; h: number };
}

export interface WireCmd extends DrawCmdBase {
  kind: "wire";
  /** Wire color / copper. */
  wire: "copper" | "red" | "green";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Rolling-stock coupling overlay: straight neon-green segments between joints
 * plus hollow circles at each bogie joint.
 */
export interface TrainChainCmd extends DrawCmdBase {
  kind: "train-chain";
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  joints: { x: number; y: number }[];
}

/** Alt-mode entity-info icon, badge, backing, or directional indicator. */
export interface IconCmd extends DrawCmdBase {
  kind: "icon";
  frame: FrameId;
  x: number;
  y: number;
  /** Destination size in tiles (square). */
  size: number;
  /** Draw a dark rounded backing behind the icon (recipe badge). */
  backing?: boolean;
  /** Atlas-backed Factorio entity-info background; preferred over synthetic backing. */
  backingFrame?: FrameId;
  /** Draw the entity-info black silhouette even when no backing is present. */
  silhouette?: boolean;
  /**
   * How to composite `backingFrame` / silhouette:
   * - `entity-info` (default): soft dark disc + black silhouette + color icon
   * - `request-pin`: cyan item-request pin at full alpha, color icon only (no silhouette)
   */
  backingStyle?: "entity-info" | "request-pin";
  /** Clockwise degrees around the icon center. */
  rotation?: number;
}

/**
 * Blueprint snap-to-grid visualization: dashed green perimeter along the snap cell.
 */
export interface SnapGridCmd extends DrawCmdBase {
  kind: "snap-grid";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Canvas text label in tile space (e.g. deconstruction planner section headers). */
export interface TextCmd extends DrawCmdBase {
  kind: "text";
  text: string;
  x: number;
  y: number;
  /** Font size in tiles (scaled by pixels-per-tile at execute time). */
  size: number;
  color: [number, number, number, number];
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "alphabetic";
}

export type DrawCmd =
  | RectCmd
  | SpriteCmd
  | WireCmd
  | TrainChainCmd
  | IconCmd
  | SnapGridCmd
  | TextCmd;

export interface DrawListBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DrawList {
  schema: 1;
  bounds: DrawListBounds;
  /** Already sorted by (layer, sortY, sortX, entity, sub); backend executes in order. */
  commands: DrawCmd[];
}

/** Comparator implementing the contract sort order. */
export function compareDrawCmd(a: DrawCmd, b: DrawCmd): number {
  return (
    a.layer - b.layer ||
    a.sortY - b.sortY ||
    a.sortX - b.sortX ||
    a.entity - b.entity ||
    a.sub - b.sub
  );
}

/**
 * Canonical serialization for Tier-2 snapshots: stable key order, numbers
 * rounded to 4 decimals, one command per line for reviewable diffs.
 */
export function serializeDrawList(list: DrawList): string {
  const roundDeep = (v: unknown): unknown => {
    if (typeof v === "number") return Math.round(v * 1e4) / 1e4;
    if (Array.isArray(v)) return v.map(roundDeep);
    if (v && typeof v === "object") {
      // Preserve key insertion order for nested objects (e.g. clip); only
      // top-level command keys are sorted for stable diffs.
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>)) {
        out[k] = roundDeep((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  const canon = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = roundDeep(obj[k]);
    }
    return out;
  };
  const lines = list.commands.map((c) =>
    JSON.stringify(canon(c as unknown as Record<string, unknown>)),
  );
  const bounds = canon(list.bounds as unknown as Record<string, unknown>);
  return `{\n"schema": ${list.schema},\n"bounds": ${JSON.stringify(bounds)},\n"commands": [\n${lines.join(",\n")}\n]\n}\n`;
}
