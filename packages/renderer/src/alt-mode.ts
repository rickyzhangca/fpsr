import { cardinalDirection } from "./resolve.js";
import type { BlueprintEntity, BlueprintFilter, SignalId } from "./types/blueprint.js";
import { RENDER_LAYERS, type IconCmd } from "./types/draw-list.js";
import type { EntityRenderDef, RenderDb } from "./types/render-db.js";

type AltSignal = SignalId & { type: string };

const SIGNAL_PREFIX: Record<string, string> = {
  item: "item",
  fluid: "fluid",
  virtual: "virtual-signal",
  "virtual-signal": "virtual-signal",
  entity: "entity",
  recipe: "recipe",
  quality: "quality",
  "space-location": "space-location",
  "asteroid-chunk": "asteroid-chunk",
};

function asSignal(value: unknown, defaultType = "item"): AltSignal | undefined {
  if (typeof value === "string") return { name: value, type: defaultType };
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (obj.id && typeof obj.id === "object") return asSignal(obj.id, defaultType);
  if (obj.value && typeof obj.value === "object") return asSignal(obj.value, defaultType);
  if (obj.signal && typeof obj.signal === "object") return asSignal(obj.signal, defaultType);
  if (typeof obj.name !== "string") return undefined;
  return {
    name: obj.name,
    type: typeof obj.type === "string" ? obj.type : defaultType,
    ...(typeof obj.quality === "string" ? { quality: obj.quality } : {}),
  };
}

function signalKey(signal: SignalId): string {
  return `${signal.type ?? "item"}/${signal.name}/${signal.quality ?? "normal"}`;
}

function collectSignals(value: unknown, defaultType = "item", out: AltSignal[] = []): AltSignal[] {
  if (Array.isArray(value)) {
    for (const item of value) collectSignals(item, defaultType, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const obj = value as Record<string, unknown>;
  const direct = asSignal(obj, defaultType);
  if (direct) {
    out.push(direct);
    return out;
  }
  for (const [key, child] of Object.entries(obj)) {
    if (key === "index" || key === "count" || key === "comparator") continue;
    collectSignals(child, defaultType, out);
  }
  return out;
}

function filterSignals(filters: BlueprintFilter[] | undefined, defaultType = "item"): AltSignal[] {
  return collectSignals(filters ?? [], defaultType);
}

function uniqueSignals(signals: AltSignal[]): AltSignal[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = signalKey(signal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Ordered render-db icon keys for a Blueprint SignalID (UI lookup chain). */
export function signalIconKeys(signal: SignalId): string[] {
  const type = signal.type ?? "item";
  const prefix = SIGNAL_PREFIX[type] ?? type;
  const primary = `${prefix}/${signal.name}`;

  switch (type) {
    case "item":
      return [primary, `entity/${signal.name}`, `recipe/${signal.name}`];
    case "entity":
      return [primary, `item/${signal.name}`];
    case "recipe":
      return [primary, `item/${signal.name}`];
    default:
      return [primary];
  }
}

/** Resolve Blueprint SignalID namespaces and tolerate older/default item shapes. */
export function altSignalFrame(db: RenderDb, signal: SignalId): number | undefined {
  for (const key of signalIconKeys(signal)) {
    const frame = db.icons[key];
    if (frame !== undefined) return frame;
  }
  return undefined;
}

const MAX_INSERT_PLAN_ICONS = 16;

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Expand insert plans into their actual inventory-slot order and multiplicity. */
function insertPlanSignals(items: BlueprintEntity["items"]): AltSignal[] {
  if (!Array.isArray(items)) return [];
  const slotted: {
    signal: AltSignal;
    inventory: number;
    stack: number;
    order: number;
  }[] = [];
  const fallback: { signal: AltSignal; order: number }[] = [];
  let order = 0;

  for (const item of items) {
    const signal = asSignal(item.id);
    if (!signal) continue;
    const positions = Array.isArray(item.items?.in_inventory) ? item.items.in_inventory : [];
    if (positions.length > 0) {
      for (const position of positions) {
        const count = Math.min(positiveInteger(position.count, 1), MAX_INSERT_PLAN_ICONS);
        for (let i = 0; i < count; i++) {
          slotted.push({
            signal: { ...signal },
            inventory: Number.isFinite(position.inventory)
              ? position.inventory
              : Number.MAX_SAFE_INTEGER,
            stack: Number.isFinite(position.stack) ? position.stack : Number.MAX_SAFE_INTEGER,
            order: order++,
          });
        }
      }
      continue;
    }

    // `grid_count` is the 2.x equipment-grid shape and is also used by the 1.x
    // items-object migration. Preserve it as a compatibility fallback.
    const gridCount = positiveInteger(item.items?.grid_count, 0);
    const count = Math.min(gridCount > 0 ? gridCount : 1, MAX_INSERT_PLAN_ICONS);
    for (let i = 0; i < count; i++) fallback.push({ signal: { ...signal }, order: order++ });
  }

  slotted.sort((a, b) => a.inventory - b.inventory || a.stack - b.stack || a.order - b.order);
  return [...slotted.map((entry) => entry.signal), ...fallback.map((entry) => entry.signal)].slice(
    0,
    MAX_INSERT_PLAN_ICONS,
  );
}

function isSplitterType(def: EntityRenderDef): boolean {
  return def.protoType === "splitter" || def.protoType === "lane-splitter";
}

/** Splitter filters render on the output-priority lane, not as centered primary icons. */
function splitterLaneFilter(entity: BlueprintEntity, def: EntityRenderDef): AltSignal | undefined {
  if (!isSplitterType(def)) return undefined;
  if (!entity.output_priority || entity.output_priority === "none") return undefined;
  return asSignal(entity.filter) ?? filterSignals(entity.filters)[0];
}

function entitySignals(entity: BlueprintEntity, def: EntityRenderDef): AltSignal[] {
  const signals: AltSignal[] = [];
  if (entity.recipe) {
    signals.push({ name: entity.recipe, type: "recipe", quality: entity.recipe_quality });
  }

  // Splitter output filters are placed on the priority lane in splitterPriorityCommands.
  if (!splitterLaneFilter(entity, def)) {
    const directFilter = asSignal(
      entity.filter,
      def.protoType === "mining-drill" ? "entity" : "item",
    );
    if (directFilter) signals.push(directFilter);
    signals.push(...filterSignals(entity.filters));
  }
  signals.push(...filterSignals(entity["priority-list"]));
  signals.push(...filterSignals(entity["chunk-filter"], "asteroid-chunk"));
  if (entity.fluid_filter) signals.push({ name: entity.fluid_filter, type: "fluid" });

  for (const inventory of [
    entity.inventory,
    entity.trunk_inventory,
    entity.ammo_inventory,
    entity.burner_fuel_inventory,
    entity["result-inventory"],
  ]) {
    signals.push(...filterSignals(inventory?.filters));
  }
  signals.push(...collectSignals(entity.request_filters));
  // Combinator / display-panel control_behavior drives built-in graphics (or
  // conditional messages); Factorio does not dump those as entity-info icons.
  // Display panels only expose a static single entity.icon in alt mode.
  if (entity.icon) signals.push({ ...entity.icon, type: entity.icon.type ?? "item" });

  return uniqueSignals(signals);
}

function iconLayout(count: number, scale: number): [number, number][] {
  if (count <= 1) return [[0, 0]];
  if (count === 2)
    return [
      [-scale * 0.3, 0],
      [scale * 0.3, 0],
    ];
  const cols = Math.min(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const spacing = scale * 0.62;
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push([(col - (cols - 1) / 2) * spacing, (row - (rows - 1) / 2) * spacing]);
  }
  return out;
}

type ResolvedAltSignal = { signal: AltSignal; frame: number };

function resolveAltSignals(db: RenderDb, signals: AltSignal[]): ResolvedAltSignal[] {
  return signals
    .map((signal) => ({
      signal,
      frame: altSignalFrame(db, signal) ?? db.icons["utility/missing-icon"],
    }))
    .filter((entry): entry is ResolvedAltSignal => entry.frame !== undefined);
}

/** Extra gap between recipe and module rows on assemblers (tiles). */
const ASSEMBLER_INSERT_PLAN_Y_OFFSET = 0.2;
/**
 * Visible request-pin size in tiles (36 px at the viewer’s default 64 ppt).
 */
const INSERT_PLAN_ICON_SCALE = 36 / 64;
/** Edge-to-edge gap between visible pin chrome (~2 px at 64 ppt). */
const INSERT_PLAN_GAP_TILES = 2 / 64;

function insertPlanLayout(count: number): { scale: number; xOffsets: number[] } {
  if (count <= 0) return { scale: 0, xOffsets: [] };
  const scale = INSERT_PLAN_ICON_SCALE;
  const step = scale + INSERT_PLAN_GAP_TILES;
  return {
    scale,
    xOffsets: Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * step),
  };
}

/**
 * Opaque pin height ÷ width from `item-request-slot` (a>20 bbox ≈ 44×62).
 * Used when estimating pin vertical extent for rolling-stock placement.
 */
const REQUEST_PIN_HEIGHT_OVER_WIDTH = 62 / 44;
/**
 * Entity corner quality badge size in tiles when `quality_indicator_scale` is 1
 * (3-tile entities).
 */
const ENTITY_QUALITY_BADGE_TILES = 0.5;
/**
 * Quality overlay on alt-info signal icons, as a fraction of the parent icon size.
 * (Separate from the selection-box entity badge.)
 */
const QUALITY_SIGNAL_OVERLAY_FRACTION = 0.5;

/** Factorio default: shorter tile span / 3, clamped to [0.5, 1]. Size 3 → scale 1. */
function qualityIndicatorScale(def: EntityRenderDef): number {
  if (typeof def.qualityIndicatorScale === "number" && Number.isFinite(def.qualityIndicatorScale)) {
    return def.qualityIndicatorScale;
  }
  const [[x1, y1], [x2, y2]] = def.collisionBox;
  const tw = Math.max(1, Math.ceil(Math.abs(x2 - x1) - 1e-6));
  const th = Math.max(1, Math.ceil(Math.abs(y2 - y1) - 1e-6));
  return Math.min(1, Math.max(0.5, Math.min(tw, th) / 3));
}

/**
 * Rolling-stock request-pin Y offset from entity center.
 *
 * Note: locomotive `icons_positioning.shift[1] = 0.3` and the IconSequencePositioning
 * default `0.7` are for inventory/burner alt-info, not item-request pins — using
 * those overshot. Empirically pins sit about half a pin-height below center.
 */
function trainInsertPlanShiftY(pinSize: number): number {
  return (pinSize * REQUEST_PIN_HEIGHT_OVER_WIDTH) / 2;
}

function qualityBadgeCommands(
  resolved: ResolvedAltSignal[],
  parents: IconCmd[],
  entityNumber: number,
  db: RenderDb,
  startSub: number,
): IconCmd[] {
  const commands: IconCmd[] = [];
  for (let index = 0; index < resolved.length; index++) {
    const quality = resolved[index]?.signal.quality;
    if (!quality || quality === "normal") continue;
    const frame = db.icons[`quality/${quality}`] ?? db.icons["utility/missing-icon"];
    const parent = parents[index];
    if (frame === undefined || !parent) continue;
    commands.push({
      kind: "icon",
      layer: RENDER_LAYERS["entity-info-icon-above"],
      sortY: 0,
      sortX: 0,
      entity: entityNumber,
      sub: startSub + index,
      frame,
      x: parent.x - parent.size * 0.3,
      y: parent.y + parent.size * 0.3,
      size: parent.size * QUALITY_SIGNAL_OVERLAY_FRACTION,
    });
  }
  return commands;
}

function swapPriority(
  priority: BlueprintEntity["input_priority"],
  mirrored: boolean | undefined,
): BlueprintEntity["input_priority"] {
  if (!mirrored || priority === "none" || priority == null) return priority;
  return priority === "left" ? "right" : "left";
}

function splitterPriorityCommands(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
  startSub: number,
): IconCmd[] {
  if (!isSplitterType(def)) return [];
  const arrowFrame = db.icons["utility/indication-arrow"];
  const direction = cardinalDirection(entity.direction ?? 0);
  const angle = direction * 22.5;
  const radians = (angle * Math.PI) / 180;
  const forward: [number, number] = [Math.sin(radians), -Math.cos(radians)];
  const right: [number, number] = [Math.cos(radians), Math.sin(radians)];
  // Both arrows point along belt travel (indication-arrow faces north at 0°).
  // Side inset keeps indicators on the splitter body (not on adjacent belt tiles).
  // Lane offset stays half-tile so arrows sit on the belt centerlines.
  // Filter icons stay on the entity centerline with a full half-tile lane shift.
  const ARROW_SIDE_OFFSET = 0.25;
  const ARROW_LANE_OFFSET = 0.5;
  const FILTER_LANE_OFFSET = 0.5;
  const specs: { priority: BlueprintEntity["input_priority"]; side: -1 | 1 }[] = [
    { priority: swapPriority(entity.input_priority, entity.mirror), side: -1 },
    { priority: swapPriority(entity.output_priority, entity.mirror), side: 1 },
  ];
  const filterSignal = splitterLaneFilter(entity, def);
  const filterFrame = filterSignal
    ? (altSignalFrame(db, filterSignal) ?? db.icons["utility/missing-icon"])
    : undefined;
  const darkBackingFrame = db.icons["utility/entity-info-dark-background"];
  const filterSize = iconDrawSpec(def).scale;
  const commands: IconCmd[] = [];
  for (const spec of specs) {
    if (!spec.priority || spec.priority === "none") continue;
    const lane = spec.priority === "right" ? 1 : -1;
    const useFilter = spec.side > 0 && filterFrame !== undefined;
    // Arrows: inset on body. Filters: entity centerline + priority lane half.
    const sideOffset = useFilter ? 0 : ARROW_SIDE_OFFSET;
    const laneOffset = useFilter ? FILTER_LANE_OFFSET : ARROW_LANE_OFFSET;
    const x =
      entity.position.x + forward[0] * sideOffset * spec.side + right[0] * laneOffset * lane;
    const y =
      entity.position.y + forward[1] * sideOffset * spec.side + right[1] * laneOffset * lane;

    if (useFilter) {
      const filterCmd: IconCmd = {
        kind: "icon",
        layer: RENDER_LAYERS["entity-info-icon-above"],
        sortY: 0,
        sortX: 0,
        entity: entity.entity_number,
        sub: startSub + commands.length,
        frame: filterFrame,
        x,
        y,
        size: filterSize,
        ...(darkBackingFrame !== undefined
          ? { backingFrame: darkBackingFrame }
          : { backing: true }),
      };
      commands.push(filterCmd);
      if (entity.filter_mode === "blacklist") {
        const blacklistFrame = db.icons["utility/filter-blacklist"];
        if (blacklistFrame !== undefined) {
          commands.push({
            kind: "icon",
            layer: RENDER_LAYERS["entity-info-icon-above"],
            sortY: 0,
            sortX: 0,
            entity: entity.entity_number,
            sub: startSub + commands.length,
            frame: blacklistFrame,
            x: filterCmd.x + filterCmd.size * 0.28,
            y: filterCmd.y + filterCmd.size * 0.28,
            size: filterCmd.size * 0.45,
          });
        }
      }
      continue;
    }

    if (arrowFrame === undefined) continue;
    const arrowSize = db.iconScales?.["utility/indication-arrow"];
    if (arrowSize === undefined) continue;
    commands.push({
      kind: "icon",
      layer: RENDER_LAYERS["entity-info-icon-above"],
      sortY: 0,
      sortX: 0,
      entity: entity.entity_number,
      sub: startSub + commands.length,
      frame: arrowFrame,
      x,
      y,
      size: arrowSize,
      rotation: angle,
    });
  }
  return commands;
}

function iconDrawSpec(def: EntityRenderDef) {
  return (
    def.iconDrawSpecification ?? {
      shift: [0, 0] as [number, number],
      scale: def.kind === "inserter" ? 0.5 : 0.75,
      scaleForMany: 0.5,
      renderLayer: "entity-info-icon" as const,
    }
  );
}

function isDirectionalCombinator(def: EntityRenderDef): boolean {
  return (
    def.protoType === "arithmetic-combinator" ||
    def.protoType === "decider-combinator" ||
    def.protoType === "selector-combinator"
  );
}

/** Input/output flow arrows shown at both ends of directional combinators. */
function combinatorFlowCommands(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): IconCmd[] {
  if (!isDirectionalCombinator(def)) return [];
  const frame = db.icons["utility/indication-arrow"];
  const spriteScale = db.iconScales?.["utility/indication-arrow"];
  if (frame === undefined || spriteScale === undefined) return [];
  // The prototype scale applies to a 64 px source; Factorio's visible triangle
  // occupies roughly half a tile once transparent padding is accounted for.
  const size = spriteScale * 1.5;

  const direction = cardinalDirection(entity.direction ?? 0);
  const angle = direction * 22.5;
  const radians = (angle * Math.PI) / 180;
  const forward: [number, number] = [Math.sin(radians), -Math.cos(radians)];
  const halfSpan = Math.max(
    Math.abs(def.selectionBox[0][0]),
    Math.abs(def.selectionBox[0][1]),
    Math.abs(def.selectionBox[1][0]),
    Math.abs(def.selectionBox[1][1]),
  );
  const frameMeta = db.frames[frame];
  const visibleArrowHeight = frameMeta ? size * (frameMeta.h / Math.max(1, frameMeta.sh)) : 0;
  // Factorio tucks each marker inward by its visible height rather than
  // centering it directly on the selection-box edge.
  const flowOffset = Math.max(0, halfSpan - visibleArrowHeight);

  return ([-1, 1] as const).map((side, index) => ({
    kind: "icon" as const,
    layer: RENDER_LAYERS["entity-info-icon-above"],
    sortY: 0,
    sortX: 0,
    entity: entity.entity_number,
    sub: 110 + index,
    frame,
    x: entity.position.x + forward[0] * flowOffset * side,
    y: entity.position.y + forward[1] * flowOffset * side,
    size,
    rotation: angle,
  }));
}

/** A filter-enabled inserter with no selected filter shows Factorio's prohibition marker. */
function emptyInserterFilterCommand(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): IconCmd | undefined {
  if (def.kind !== "inserter" || entity.use_filters !== true) return undefined;
  if (filterSignals(entity.filters).length > 0) return undefined;
  const frame = db.icons["virtual-signal/signal-no-entry"];
  if (frame === undefined) return undefined;
  const spec = iconDrawSpec(def);
  return {
    kind: "icon",
    layer: RENDER_LAYERS["entity-info-icon-above"],
    sortY: 0,
    sortX: 0,
    entity: entity.entity_number,
    sub: 112,
    frame,
    x: entity.position.x + spec.shift[0],
    y: entity.position.y + spec.shift[1],
    size: spec.scale,
    silhouette: true,
  };
}

/**
 * Build insert-plan request-pin icons (sub 20–49). Always shown, not gated by alt mode.
 * Y matches the Factorio layout used when recipe/primary icons are present: pins sit
 * below those icons when the entity has primary signals, otherwise at the entity anchor.
 */
export function planRequestPinCommands(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): IconCmd[] {
  const insertPlans = resolveAltSignals(db, insertPlanSignals(entity.items));
  if (insertPlans.length === 0) return [];

  const spec = iconDrawSpec(def);
  const pinBackingFrame = db.icons["utility/item-request-slot"];
  const darkBackingFrame = db.icons["utility/entity-info-dark-background"];
  const useRequestPin = pinBackingFrame !== undefined;
  const layer = RENDER_LAYERS[spec.renderLayer];
  const insertLayout = insertPlanLayout(insertPlans.length);

  // Rolling stock: request pins hang below entity center by ~half pin height.
  // Do not reuse icon_draw_specification (cargo badge) or icons_positioning
  // (burner alt-info) — those are different overlays.
  const insertAnchorY =
    def.kind === "train"
      ? entity.position.y + trainInsertPlanShiftY(insertLayout.scale)
      : entity.position.y + spec.shift[1];

  const primary = resolveAltSignals(db, entitySignals(entity, def));
  let insertY = insertAnchorY;
  if (primary.length > 0) {
    const primaryScale = primary.length > 1 ? spec.scaleForMany : spec.scale;
    const primaryOffsets = iconLayout(primary.length, primaryScale);
    const primaryBottom = primary.reduce((bottom, _entry, index) => {
      const y = entity.position.y + spec.shift[1] + (primaryOffsets[index]?.[1] ?? 0);
      return Math.max(bottom, y + primaryScale / 2);
    }, Number.NEGATIVE_INFINITY);
    const assemblerInsertYOffset = def.kind === "assembler" ? ASSEMBLER_INSERT_PLAN_Y_OFFSET : 0;
    insertY = primaryBottom + insertLayout.scale / 2 + assemblerInsertYOffset;
  }

  return insertPlans.map(({ frame }, index) => ({
    kind: "icon" as const,
    layer,
    sortY: 0,
    sortX: 0,
    entity: entity.entity_number,
    sub: 20 + index,
    frame,
    x: entity.position.x + spec.shift[0] + (insertLayout.xOffsets[index] ?? 0),
    y: insertY,
    size: insertLayout.scale,
    ...(useRequestPin
      ? { backingFrame: pinBackingFrame, backingStyle: "request-pin" as const }
      : darkBackingFrame !== undefined
        ? { backingFrame: darkBackingFrame }
        : { backing: true }),
  }));
}

/** Build deterministic alt-mode (entity-info) commands for one blueprint entity. */
export function planAltModeCommands(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
  opts?: { insertCommands?: IconCmd[] },
): IconCmd[] {
  const spec = iconDrawSpec(def);
  const primary = resolveAltSignals(db, entitySignals(entity, def));
  const primaryScale = primary.length > 1 ? spec.scaleForMany : spec.scale;
  const primaryOffsets = iconLayout(primary.length, primaryScale);
  const darkBackingFrame = db.icons["utility/entity-info-dark-background"];
  const layer = RENDER_LAYERS[spec.renderLayer];
  const primaryCommands: IconCmd[] = primary.map(({ frame }, index) => ({
    kind: "icon",
    layer,
    sortY: 0,
    sortX: 0,
    entity: entity.entity_number,
    sub: index,
    frame,
    x: entity.position.x + spec.shift[0] + (primaryOffsets[index]?.[0] ?? 0),
    y: entity.position.y + spec.shift[1] + (primaryOffsets[index]?.[1] ?? 0),
    size: primaryScale,
    ...(darkBackingFrame !== undefined ? { backingFrame: darkBackingFrame } : { backing: true }),
  }));

  const insertCommands = opts?.insertCommands ?? [];
  const insertPlans =
    insertCommands.length > 0
      ? resolveAltSignals(db, insertPlanSignals(entity.items)).slice(0, insertCommands.length)
      : [];

  const commands: IconCmd[] = [
    ...primaryCommands,
    ...qualityBadgeCommands(primary, primaryCommands, entity.entity_number, db, 50),
    ...(insertCommands.length > 0
      ? qualityBadgeCommands(insertPlans, insertCommands, entity.entity_number, db, 60)
      : []),
  ];

  if (
    entity.filter_mode === "blacklist" &&
    commands.length > 0 &&
    !splitterLaneFilter(entity, def)
  ) {
    const frame = db.icons["utility/filter-blacklist"];
    if (frame !== undefined) {
      commands.push({
        kind: "icon",
        layer: RENDER_LAYERS["entity-info-icon-above"],
        sortY: 0,
        sortX: 0,
        entity: entity.entity_number,
        sub: 80,
        frame,
        x: commands[0]!.x + commands[0]!.size * 0.28,
        y: commands[0]!.y + commands[0]!.size * 0.28,
        size: commands[0]!.size * 0.45,
      });
    }
  }

  const quality = entity.quality;
  if (quality && quality !== "normal") {
    const frame = db.icons[`quality/${quality}`] ?? db.icons["utility/missing-icon"];
    if (frame !== undefined) {
      const size = ENTITY_QUALITY_BADGE_TILES * qualityIndicatorScale(def);
      const [x1] = def.selectionBox[0];
      const [, y2] = def.selectionBox[1];
      commands.push({
        kind: "icon",
        layer: RENDER_LAYERS["entity-info-icon-above"],
        sortY: 0,
        sortX: 0,
        entity: entity.entity_number,
        sub: 90,
        frame,
        x: entity.position.x + x1 + size / 2,
        y: entity.position.y + y2 - size / 2,
        size,
      });
    }
  }

  commands.push(...splitterPriorityCommands(entity, def, db, 100));
  commands.push(...combinatorFlowCommands(entity, def, db));
  const emptyFilter = emptyInserterFilterCommand(entity, def, db);
  if (emptyFilter) commands.push(emptyFilter);
  return commands;
}
