/**
 * The render database ("render-db") IR: everything the runtime needs to draw a
 * blueprint, distilled offline by tools/pipeline from Factorio's data.raw dump.
 *
 * Design rules:
 * - The runtime is dumb: all prototype heterogeneity (animation / sprite4way /
 *   rotated_sprite / belt_animation_set / connection pictures / graphics_set)
 *   is normalized here by the pipeline. The runtime only selects variants.
 * - Outer shapes here are a stable contract. Kind-specific payloads
 *   (`EntityRenderDef.data`) may be extended additively; document new kinds in
 *   this file when adding them.
 * - Keep it compact: this JSON ships to browsers. Frames are an array (ids are
 *   indices); geometry is rounded by the pipeline.
 */

/** Index into RenderDb.frames. */
export type FrameId = number;

export interface AtlasMeta {
  /** Content-addressed PNG filename resolved relative to the asset base. */
  file: string;
  width: number;
  height: number;
}

/**
 * One packed sprite frame. Trimmed: (x,y,w,h) is the opaque sub-rect inside the
 * atlas; (ox,oy) is its offset within the untrimmed source sprite of size (sw,sh).
 */
export interface FrameMeta {
  /** Atlas index. */
  a: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  sw: number;
  sh: number;
  /** Packed dimensions when this atlas tier stores a downsampled frame. */
  pw?: number;
  ph?: number;
}

/**
 * A drawable sprite variant: a frame plus placement.
 * On-map untrimmed size in tiles = (sw * scale / 32, sh * scale / 32), centered
 * on the entity position, then offset by `shift` (tile units, +x east, +y south).
 */
export interface SpriteVariant {
  frame: FrameId;
  /** Prototype scale (typically 0.5). */
  scale: number;
  /** Tile-unit shift of the sprite center relative to the entity position. */
  shift: [number, number];
  /** RGBA 0-1. */
  tint?: [number, number, number, number];
  drawAsShadow?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  /**
   * Optional extra Y scale (1 = none). Used to foreshorten inserter hands
   * (FBE `squishY` → scaleY = 1/squishY).
   */
  scaleY?: number;
  /**
   * Clockwise rotation in degrees around the sprite center (canvas convention).
   * Used for inserter hands (north-facing source art rotated per direction).
   */
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

/**
 * fpsr-only layer names / legacy aliases (not in Factorio's enum, or renamed).
 */
export type FpsrRenderLayerName =
  | "ground-tile" // ≈ under-tiles
  | "tile-transition" // ≈ background-transitions
  | "water-tile"
  | "rail-ties" // alias of rail-tie
  | "shadow"
  | "elevated-rail-ties" // alias of elevated-rail-tie
  | "icons"; // alias of entity-info-icon

/** Layer names used in the render-db / planner. */
export type RenderLayerName = FactorioRenderLayerName | FpsrRenderLayerName;

/**
 * One visual layer of an entity. `variants[variantKey][index]` where:
 * - variantKey: chosen by the connectivity resolver ("default" when trivial;
 *   e.g. connection-bitmask strings for pipes/walls, "left"/"right" for
 *   splitter halves, etc. — resolver and pipeline must agree per `kind`).
 * - index: direction/frame index. Its meaning is given by `indexing`.
 */
export interface LayerGroup {
  layer: RenderLayerName;
  /**
   * How `index` is derived from the entity:
   * - "single": always index 0
   * - "direction4": [N,E,S,W] -> 0..3 (direction/4)
   * - "direction8": 0..7 (direction/2)
   * - "direction16": raw blueprint direction 0..15
   * - "resolver": index computed by the connectivity resolver (belts' 20-way
   *   curve table, rail pieces, etc.)
   */
  indexing: "single" | "direction4" | "direction8" | "direction16" | "resolver";
  variants: Record<string, (SpriteVariant | null)[]>;
}

/**
 * Resolver strategy discriminator. Adding a kind = adding a resolver strategy
 * and (usually) a `data` payload; keep both documented here.
 * - "simple": no neighbor logic; direction-indexed layers only.
 * - "belt": transport belt; resolver picks index 0..19 from the belt curve table.
 * - "underground-belt", "loader": uses entity `type` (input/output) + direction.
 * - "splitter": two-tile entity, layers for whole body per direction.
 * - "pipe": variantKey = connection bitmask "NESW" (e.g. "1010").
 * - "heat-pipe", "wall": same bitmask scheme as pipe.
 * - "gate": wall gate, horizontal/vertical variants.
 * - "inserter": platform + arm parts (static pose).
 * - "assembler": body (+ optional fluid-box pipe pictures when recipe needs them).
 * - "rail": rail piece kinds; direction8-indexed layered sprites (stone/ties/metal).
 * - "rail-signal": signal with direction16 indexing plus elevated variants.
 * - "train": rolling stock; index from continuous `orientation` via
 *   `data.orientationCount` (pose count in variants.default).
 * - "storage-tank", "mining-drill", "offshore-pump", "pump", "power-pole",
 *   "roboport", "beacon", "reactor", "turret", ...: treated as "simple" unless
 *   a dedicated kind is introduced.
 *
 * Kind-specific `data` (additive):
 * - `wireAnchors`: Record<dirIndex, { copper?: [x,y], red?: [x,y], green?: [x,y] }>
 *   tile-space offsets from entity center for wire endpoints (poles + circuit).
 * - `wireAnchorsOutput`: same shape as `wireAnchors`, used for combinator output
 *   connectors (ids 3/4) and power-switch right copper (id 6). When absent, the
 *   planner falls back to `wireAnchors`.
 * - `wireConnectorGraphics`: circuit-connector decorations (CCM) drawn when the
 *   entity appears in `bp.wires`. Shape:
 *   `{ indexing: "direction4"|"direction16"|"single", layers: {
 *        connector_shadow?, connector_main?, wire_pins_shadow?, wire_pins?,
 *        led_blue_off?: (SpriteVariant|null)[] } }`
 * - `combinatorGraphics`: direction4 operator/comparator display sprites keyed
 *   by blueprint operation (for example `*`, `≥`, `max`, or `min`).
 * - `beltConnectorGraphics`: transport-belt yellow cage + LEDs when wired. Shape:
 *   `{ indexing: "belt-topology", layers: {
 *        frame_shadow?, frame_main?: (SpriteVariant|null)[][],  // [variation][behavior state]
 *        frame_back_patch?: (SpriteVariant|null)[],            // 3 variations
 *        wire_horizontal?, wire_vertical?: (SpriteVariant|null)[][], // décor by mode
 *        led_red?, led_green?, led_blue?: (SpriteVariant|null)[] } }`
 *   Variation order: X, H, V, SE, SW, NE, NW (Factorio TransportBeltPrototype).
 *   Behavior-state order: none, output, input, both (bitmask 0..3).
 *   Output (`circuit_enabled`) → wire_horizontal + led_red/green;
 *   input (`circuit_read_hand_contents`) → wire_vertical + led_blue.
 * - `beltReaderGraphics`: whole-belt-read side skirts (`belt_animation_set.belt_reader`).
 *   Shape: `{ indexing: "belt-reader-band-nesw", layers: { layer, variants: SpriteVariant[4][4] }[] }`
 *   (bands × N/E/S/W edge frames; see Factorio BeltReaderLayer validation).
 *   variants indexed east=0, west=1, north=2, south=3.
 * - `orientationCount`: number of distilled train or vehicle poses. Each uses
 *   its corresponding camera/original-sheet projection; only trains add
 *   rail/bogie geometry.
 * - `backEqualsFront`: cargo/fluid wagon bodies only author half a turn; index
 *   folds with `round(o * 2N) % N` (wheels stay full-circle).
 * - `wheelsGroupIndex` / `jointDistance` / `connectionDistance`: rolling-stock
 *   bogies are drawn twice at ±jointDistance/2 along circular orientation
 *   (Factorio RollingStock). The forward bogie uses orientation+0.5 so coupler
 *   hooks face outward. `connectionDistance` is the gap between facing joints
 *   of two coupled wagons (default 3); used by the train-chain overlay.
 * - `cannonGroupIndices` / `cannonBaseHeight` /
 *   `cannonBaseShiftWhenVertical` / `cannonBaseShiftWhenHorizontal`:
 *   artillery-wagon cannon barrel+base layers and mount offset (FBSR).
 * - `colorMaskGroupIndex` / `colorMaskGroupIndices`: graphics group(s) that are
 *   runtime-tint masks (apply `entity.color` / `defaultColor` at plan time).
 * - `defaultColor`: prototype `color` for rolling stock when the blueprint omits it.
 * - `fluidConnections` / `heatConnections` / `tileSize` / … (see M2).
 * - `pipeCovers`: `{ covers: SpriteVariant[4], shadows?: SpriteVariant[4] }` —
 *   fluid-box pipe covers (N/E/S/W). Planner draws a cover on each *unconnected*
 *   port's adjacent tile (Factorio: pictures when no FluidBox is connected).
 * - `placeholder`: true when the pipeline baked a gray footprint sprite because
 *   no usable graphics were resolved; `placeholderReason` explains why.
 */
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
  /** Factorio prototype type (e.g. "transport-belt"), for resolver heuristics. */
  protoType: string;
  /** Collision box [[x1,y1],[x2,y2]] relative to entity center, tile units. */
  collisionBox: [[number, number], [number, number]];
  /** Selection box, used for bounds and the viewer's hover UI. */
  selectionBox: [[number, number], [number, number]];
  /** Ordered visual layers (sub-order within the entity). */
  graphics: LayerGroup[];
  /**
   * Kind-specific extra data (belt speed group, fluid box connection positions,
   * wire connection anchor points per direction, splitter half offsets, ...).
   * Additive extension point — resolver code owns its shape per kind.
   */
  data?: Record<string, unknown>;
  /** Icon frame for alt-mode fallbacks and the viewer. */
  icon?: FrameId;
  /** Factorio prototype placement rules for entity-info (alt-mode) overlays. */
  iconDrawSpecification?: {
    shift: [number, number];
    scale: number;
    scaleForMany: number;
    renderLayer: "entity-info-icon" | "entity-info-icon-above" | "air-entity-info-icon";
  };
  /**
   * Scale for the selection-box quality badge (`EntityPrototype.quality_indicator_scale`).
   * Default when omitted: clamp(min(tile_w, tile_h) / 3, 0.5, 1) from the collision box.
   */
  qualityIndicatorScale?: number;
}

/** Factorio `material_background` atlas: repeating patchW×patchH variants. */
export interface TileMaterialAtlas {
  /** Cropped material_background spritesheet (all variant patches). */
  sheet: FrameId;
  /** `material_background.count`. */
  count: number;
  /** `material_texture_width_in_tiles` (default 8). */
  patchW: number;
  /** `material_texture_height_in_tiles` (default 8). */
  patchH: number;
  /** Source pixels per map tile (`32 / material_background.scale`). */
  tilePx: number;
  /** `material_background.line_length`; 0 = single horizontal row. */
  lineLength?: number;
  /** `material_background.x` / `y` offset into the source file (pixels). */
  sheetX?: number;
  sheetY?: number;
}

export interface TileRenderDef {
  layer: RenderLayerName;
  /** Item that places this tile (`place_as_tile.result`); used for UI icons. */
  item?: string;
  /**
   * Plain color fallback (RGBA 0-1). When atlases are unavailable, tiles draw as
   * solid rects using this color.
   */
  color: [number, number, number, number];
  /**
   * Legacy 1×1 hashed variants from `variants.main[0]` (e.g. stone-path size-1
   * sheet). Multi-size 2×2 / 4×4 packing is not implemented yet.
   */
  frames?: FrameId[];
  /** Factorio `material_background` mode (concrete, landfill, hazard, …). */
  material?: TileMaterialAtlas;
}

export interface RenderDb {
  /** Schema version of this IR; bump on breaking change. */
  schema: 2;
  gameVersion: string;
  mods: string[];
  /** Physical atlas density; frame geometry remains in canonical 2× pixels. */
  assetDensity?: 1 | 2;
  atlases: AtlasMeta[];
  frames: FrameMeta[];
  entities: Record<string, EntityRenderDef>;
  tiles: Record<string, TileRenderDef>;
  /** Icon frames by "type/name" (e.g. "item/iron-plate", "utility/unsupported-entity"). */
  icons: Record<string, FrameId>;
  /**
   * Optional on-map tile size for utility (and similar) icons whose Factorio Sprite
   * carries an explicit `scale`. Missing keys fall back to caller defaults.
   * Example: utility-sprites.indication_arrow has scale 0.5.
   */
  iconScales?: Record<string, number>;
}
