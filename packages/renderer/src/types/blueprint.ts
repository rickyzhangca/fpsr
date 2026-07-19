/**
 * Decoded model for the Factorio 2.x blueprint string format.
 * Reference: https://wiki.factorio.com/Blueprint_string_format and the 2.1.11
 * runtime docs (BlueprintEntity, BlueprintWire).
 *
 * Design rules:
 * - Types are permissive: every object keeps an index signature so unknown or
 *   future fields survive a decode -> encode round trip byte-for-byte (after
 *   JSON canonicalization). The decoder must never drop fields it does not know.
 * - Field names mirror the JSON exactly (snake_case).
 */

export interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface Position {
  x: number;
  y: number;
}

/** A signal id used in icons, filters, and control behavior. */
export interface SignalId {
  name: string;
  /** "item" (default), "fluid", "virtual", "entity", "recipe", "space-location", "asteroid-chunk", "quality" */
  type?: string;
  quality?: string;
  [key: string]: unknown;
}

export interface Icon {
  signal: SignalId;
  /** 1-based */
  index: number;
  [key: string]: unknown;
}

/** Item/signal filter shapes used by inventories, inserters, loaders, and splitters. */
export interface BlueprintFilter {
  index?: number;
  name?: string;
  quality?: string;
  comparator?: string;
  id?: SignalId;
  value?: SignalId;
  [key: string]: unknown;
}

/** One target stack for an item requested by a blueprint entity. */
export interface BlueprintInventoryPosition {
  inventory: number;
  /** Zero-based stack index. */
  stack: number;
  /** Number of items requested for this stack; defaults to 1. */
  count?: number;
  [key: string]: unknown;
}

/** Inventory/equipment-grid destinations for a requested blueprint item. */
export interface BlueprintItemInventoryPositions {
  in_inventory?: BlueprintInventoryPosition[];
  grid_count?: number;
  [key: string]: unknown;
}

export interface BlueprintInsertPlan {
  id: SignalId;
  items?: BlueprintItemInventoryPositions;
  [key: string]: unknown;
}

export interface BlueprintInventory {
  filters?: BlueprintFilter[];
  bar?: number;
  [key: string]: unknown;
}

export interface Tile {
  name: string;
  /** Top-left corner of the tile. */
  position: Position;
  [key: string]: unknown;
}

/**
 * A wire connection (2.0 top-level format):
 * [source_entity_number, source_wire_connector_id, target_entity_number, target_wire_connector_id]
 * Connector ids follow defines.wire_connector_id (see wire-connectors.ts).
 */
export type BlueprintWire = [number, number, number, number];

/**
 * Factorio 2.0 top-level rolling-stock coupling entry
 * (`BlueprintRollingStockConnection`).
 */
export interface BlueprintRollingStockConnection {
  /** entity_number of this rolling-stock piece. */
  stock: number;
  /** entity_number of the stock coupled to this piece's front joint. */
  front?: number;
  /** entity_number of the stock coupled to this piece's back joint. */
  back?: number;
}

export interface BlueprintEntity {
  entity_number: number;
  name: string;
  /** Entity center, tile units. */
  position: Position;
  /** 16-way direction (0 = N, 4 = E, 8 = S, 12 = W). Absent means 0. */
  direction?: number;
  /** 2.0: flipped entity (splitters/refineries etc. in mirrored blueprints). */
  mirror?: boolean;
  quality?: string;
  /** Rolling stock / some rails: continuous orientation in [0, 1). */
  orientation?: number;
  /** Rolling stock / train-stop paint color (0–1 channels; some exports use 0–255). */
  color?: Color;
  recipe?: string;
  recipe_quality?: string;
  /** "input" | "output" for underground belts and loaders. */
  type?: string;
  /** Item requests (2.0 insert plans with inventory positions and/or equipment-grid count). */
  items?: BlueprintInsertPlan[];
  bar?: number;
  filters?: BlueprintFilter[];
  /** Inserter filter mode may be enabled even when no static filter is selected. */
  use_filters?: boolean;
  filter?: BlueprintFilter;
  filter_mode?: "whitelist" | "blacklist";
  input_priority?: "left" | "right" | "none";
  output_priority?: "left" | "right" | "none";
  "priority-list"?: BlueprintFilter[];
  "chunk-filter"?: BlueprintFilter[];
  fluid_filter?: string;
  request_filters?: Record<string, unknown>;
  inventory?: BlueprintInventory;
  trunk_inventory?: BlueprintInventory;
  ammo_inventory?: BlueprintInventory;
  burner_fuel_inventory?: BlueprintInventory;
  "result-inventory"?: BlueprintInventory;
  icon?: SignalId;
  control_behavior?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Blueprint {
  item: "blueprint";
  label?: string;
  label_color?: Color;
  description?: string;
  icons?: Icon[];
  entities?: BlueprintEntity[];
  tiles?: Tile[];
  wires?: BlueprintWire[];
  schedules?: unknown[];
  /**
   * Factorio 2.0 rolling-stock coupling graph.
   * Each entry: which wagon (`stock`) and optional front/back neighbors by entity_number.
   */
  stock_connections?: BlueprintRollingStockConnection[];
  parameters?: unknown[];
  /** Encoded game version (major<<48 | minor<<32 | patch<<16). Fits in a JS number. */
  version: number;
  "snap-to-grid"?: Position;
  "absolute-snapping"?: boolean;
  "position-relative-to-grid"?: Position;
  [key: string]: unknown;
}

/** Book-slot wrappers: exactly one content key is present (unknown fields preserved). */
export type BlueprintBookEntry = {
  /** 0-based slot index. */
  index: number;
  [key: string]: unknown;
} & (
  | {
      blueprint: Blueprint;
      blueprint_book?: never;
      upgrade_planner?: never;
      deconstruction_planner?: never;
    }
  | {
      blueprint_book: BlueprintBook;
      blueprint?: never;
      upgrade_planner?: never;
      deconstruction_planner?: never;
    }
  | {
      upgrade_planner: Record<string, unknown>;
      blueprint?: never;
      blueprint_book?: never;
      deconstruction_planner?: never;
    }
  | {
      deconstruction_planner: Record<string, unknown>;
      blueprint?: never;
      blueprint_book?: never;
      upgrade_planner?: never;
    }
);

export interface BlueprintBook {
  item: "blueprint-book";
  label?: string;
  label_color?: Color;
  description?: string;
  icons?: Icon[];
  blueprints?: BlueprintBookEntry[];
  active_index?: number;
  version: number;
  [key: string]: unknown;
}

/**
 * Top-level decoded document: exactly one wrapper key is present.
 * Unknown extra fields are preserved for encode round-trips.
 */
export type BlueprintDocument = { [key: string]: unknown } & (
  | {
      blueprint: Blueprint;
      blueprint_book?: never;
      upgrade_planner?: never;
      deconstruction_planner?: never;
    }
  | {
      blueprint_book: BlueprintBook;
      blueprint?: never;
      upgrade_planner?: never;
      deconstruction_planner?: never;
    }
  | {
      upgrade_planner: Record<string, unknown>;
      blueprint?: never;
      blueprint_book?: never;
      deconstruction_planner?: never;
    }
  | {
      deconstruction_planner: Record<string, unknown>;
      blueprint?: never;
      blueprint_book?: never;
      upgrade_planner?: never;
    }
);

/** Flattened reference to a renderable blueprint inside a (possibly nested) book. */
export interface BlueprintRef {
  /** Book-entry index path from the root; [] when the root is a bare blueprint. */
  path: number[];
  label?: string;
  /** Nesting depth (0 = root). */
  depth: number;
}

export function decodeVersion(v: number): {
  major: number;
  minor: number;
  patch: number;
} {
  return {
    major: Math.floor(v / 2 ** 48) % 2 ** 16,
    minor: Math.floor(v / 2 ** 32) % 2 ** 16,
    patch: Math.floor(v / 2 ** 16) % 2 ** 16,
  };
}
