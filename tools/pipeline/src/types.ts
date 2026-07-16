/** Local mirror of packages/renderer RenderDb IR (do not import across packages). */

export type FrameId = number;

export interface AtlasMeta {
  file: string;
  width: number;
  height: number;
}

export interface FrameMeta {
  a: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  sw: number;
  sh: number;
  pw?: number;
  ph?: number;
}

export interface SpriteVariant {
  frame: FrameId;
  scale: number;
  shift: [number, number];
  tint?: [number, number, number, number];
  drawAsShadow?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  /** Extra Y scale (1 = none); foreshortens inserter hands. */
  scaleY?: number;
  /** Clockwise degrees around the sprite center. */
  rotation?: number;
}

/**
 * Factorio `RenderLayer` names (full enum from
 * https://lua-api.factorio.com/latest/types/RenderLayer.html ).
 */
export type FactorioRenderLayerName =
  | "zero"
  | "background-transitions"
  | "under-tiles"
  | "decals"
  | "above-tiles"
  | "ground-layer-1"
  | "ground-layer-2"
  | "ground-layer-3"
  | "ground-layer-4"
  | "ground-layer-5"
  | "lower-radius-visualization"
  | "radius-visualization"
  | "transport-belt-integration"
  | "resource"
  | "building-smoke"
  | "rail-stone-path-lower"
  | "rail-stone-path"
  | "rail-tie"
  | "decorative"
  | "ground-patch"
  | "ground-patch-higher"
  | "ground-patch-higher2"
  | "rail-chain-signal-metal"
  | "rail-screw"
  | "rail-metal"
  | "remnants"
  | "floor"
  | "transport-belt"
  | "transport-belt-endings"
  | "floor-mechanics-under-corpse"
  | "corpse"
  | "floor-mechanics"
  | "item"
  | "transport-belt-reader"
  | "lower-object"
  | "transport-belt-circuit-connector"
  | "lower-object-above-shadow"
  | "lower-object-overlay"
  | "object-under"
  | "object"
  | "cargo-hatch"
  | "higher-object-under"
  | "higher-object-above"
  | "train-stop-top"
  | "item-in-inserter-hand"
  | "above-inserters"
  | "wires"
  | "under-elevated"
  | "elevated-rail-stone-path-lower"
  | "elevated-rail-stone-path"
  | "elevated-rail-tie"
  | "elevated-rail-screw"
  | "elevated-rail-metal"
  | "elevated-lower-object"
  | "elevated-object"
  | "elevated-higher-object"
  | "fluid-visualization"
  | "wires-above"
  | "entity-info-icon"
  | "entity-info-icon-above"
  | "explosion"
  | "projectile"
  | "smoke"
  | "air-object"
  | "air-entity-info-icon"
  | "light-effect"
  | "selection-box"
  | "higher-selection-box"
  | "collision-selection-box"
  | "arrow"
  | "cursor";

/** fpsr-only layer names / legacy aliases. */
export type FpsrRenderLayerName =
  | "ground-tile"
  | "tile-transition"
  | "water-tile"
  | "rail-ties"
  | "shadow"
  | "elevated-rail-ties"
  | "icons";

export type RenderLayerName = FactorioRenderLayerName | FpsrRenderLayerName;

export interface LayerGroup {
  layer: RenderLayerName;
  indexing: "single" | "direction4" | "direction8" | "direction16" | "resolver";
  variants: Record<string, (SpriteVariant | null)[]>;
}

export type EntityKind =
  | "simple"
  | "belt"
  | "underground-belt"
  | "loader"
  | "splitter"
  | "pipe"
  | "heat-pipe"
  | "wall"
  | "gate"
  | "inserter"
  | "assembler"
  | "rail"
  | "rail-signal"
  | "vehicle"
  | "train";

export interface EntityRenderDef {
  kind: EntityKind;
  protoType: string;
  collisionBox: [[number, number], [number, number]];
  selectionBox: [[number, number], [number, number]];
  graphics: LayerGroup[];
  data?: Record<string, unknown>;
  icon?: FrameId;
  iconDrawSpecification?: {
    shift: [number, number];
    scale: number;
    scaleForMany: number;
    renderLayer: "entity-info-icon" | "entity-info-icon-above" | "air-entity-info-icon";
  };
  /** EntityPrototype.quality_indicator_scale (explicit or distilled default). */
  qualityIndicatorScale?: number;
}

export interface TileMaterialAtlas {
  sheet: FrameId;
  count: number;
  patchW: number;
  patchH: number;
  tilePx: number;
  lineLength?: number;
  sheetX?: number;
  sheetY?: number;
}

export interface TileRenderDef {
  layer: RenderLayerName;
  /** Item that places this tile (`place_as_tile.result`); used for UI icons. */
  item?: string;
  color: [number, number, number, number];
  frames?: FrameId[];
  material?: TileMaterialAtlas;
}

export interface RenderDb {
  schema: 2;
  gameVersion: string;
  mods: string[];
  assetDensity?: 1 | 2;
  atlases: AtlasMeta[];
  frames: FrameMeta[];
  entities: Record<string, EntityRenderDef>;
  tiles: Record<string, TileRenderDef>;
  icons: Record<string, FrameId>;
  /** On-map tile size from Factorio Sprite.scale for selected utility icons. */
  iconScales?: Record<string, number>;
}

/** Loose Factorio sprite / animation table from data-raw-dump.json. */
export interface RawSprite {
  filename?: string;
  filenames?: string[];
  width?: number;
  height?: number;
  size?: number | [number, number];
  x?: number;
  y?: number;
  position?: [number, number];
  shift?: [number, number];
  scale?: number;
  frame_count?: number;
  /** RotatedAnimation frame used when the animation is not running. */
  still_frame?: number;
  /**
   * SpriteNWaySheet: how many direction frames are packed in this sheet
   * (Factorio uses `frames`, not `frame_count`, for storage-tank etc.).
   */
  frames?: number;
  line_length?: number;
  direction_count?: number;
  /** When true, sheet authors half a turn; east/west share poses. */
  back_equals_front?: boolean;
  lines_per_file?: number;
  repeat_count?: number;
  variation_count?: number;
  tint?: number[] | { r?: number; g?: number; b?: number; a?: number };
  draw_as_shadow?: boolean;
  draw_as_light?: boolean;
  /** Additive glow sheets are mostly opaque black + bright pixels; skip for idle. */
  draw_as_glow?: boolean;
  blend_mode?: string;
  apply_runtime_tint?: boolean;
  /** RotatedAnimation stripes: direction rows split across one or more files. */
  stripes?: {
    filename: string;
    width_in_frames: number;
    height_in_frames: number;
  }[];
  layers?: RawSprite[];
  sheet?: RawSprite;
  sheets?: RawSprite[];
  north?: RawSprite;
  east?: RawSprite;
  south?: RawSprite;
  west?: RawSprite;
  [key: string]: unknown;
}

export type DataRaw = Record<string, Record<string, Record<string, unknown>>>;
