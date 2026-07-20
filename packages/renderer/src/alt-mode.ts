import { iconDrawSpec, iconLayout, insertPlanSignals } from "./alt-mode-request-pin.js";
import {
  altSignalFrame,
  entitySignals,
  filterSignals,
  isSplitterType,
  resolveAltSignals,
  splitterLaneFilter,
  type ResolvedAltSignal,
} from "./alt-mode-signals.js";
import { activeFluidPorts } from "./resolve/fluid-ports.js";
import { cardinalDirection, DIR_DELTA } from "./resolve/shared.js";
import type { BlueprintEntity } from "./types/blueprint.js";
import { RENDER_LAYERS, type IconCmd } from "./types/draw-list.js";
import type { EntityRenderDef, RenderDb } from "./types/render-db.js";

export { planRequestPinCommands } from "./alt-mode-request-pin.js";
export { altSignalFrame, signalIconKeys } from "./alt-mode-signals.js";

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

function skipsFluidIndication(def: EntityRenderDef): boolean {
  return (
    def.kind === "pipe" || def.protoType === "pipe-to-ground" || def.protoType === "storage-tank"
  );
}

/**
 * Blue fluid-indication arrows at each active machine fluid opening (Factorio
 * `utility/fluid-indication-arrow`). Anchored at `pipe_connections.position`,
 * then nudged outward along the opening facing so the marker sits clear of the
 * machine body (similar prominence to yellow indication arrows).
 */
function fluidPortIndicationCommands(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
  startSub: number,
): IconCmd[] {
  if (skipsFluidIndication(def) || !def.data?.fluidConnections) return [];
  const oneWayFrame = db.icons["utility/fluid-indication-arrow"];
  const bothWaysFrame = db.icons["utility/fluid-indication-arrow-both-ways"];
  const oneWayScale = db.iconScales?.["utility/fluid-indication-arrow"];
  const bothWaysScale = db.iconScales?.["utility/fluid-indication-arrow-both-ways"];
  if (oneWayFrame === undefined || oneWayScale === undefined) return [];

  const ports = activeFluidPorts(entity, def, db);
  const commands: IconCmd[] = [];
  for (let i = 0; i < ports.length; i++) {
    const port = ports[i]!;
    const bothWays = port.flow === "input-output";
    const frame = bothWays ? (bothWaysFrame ?? oneWayFrame) : oneWayFrame;
    // Same IconCmd.size as yellow splitter arrows (`utility/indication-arrow`
    // scale 0.5). Fluid sprites are 48×48 vs yellow's 64×64, so the visible
    // triangle ends up slightly larger in the same tile box — close to Factorio.
    const size = bothWays ? (bothWaysScale ?? oneWayScale) : oneWayScale;
    const [dx, dy] = DIR_DELTA[port.facing];
    // Connection point, then push outward 1.25× arrow size so markers sit
    // just clear of the machine face.
    const outward = size * 1.25;
    const x = entity.position.x + port.offset[0] - dx + dx * outward;
    const y = entity.position.y + port.offset[1] - dy + dy * outward;
    // Sprite faces north; output/both-ways point outward, input points inward.
    const rotation = port.facing * 22.5 + (port.flow === "input" ? 180 : 0);
    commands.push({
      kind: "icon",
      layer: RENDER_LAYERS["entity-info-icon-above"],
      sortY: 0,
      sortX: 0,
      entity: entity.entity_number,
      sub: startSub + i,
      frame,
      x,
      y,
      size,
      rotation,
    });
  }
  return commands;
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
      ? resolveAltSignals(db, insertPlanSignals(entity.items, def)).slice(0, insertCommands.length)
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
  commands.push(...fluidPortIndicationCommands(entity, def, db, 120));
  const emptyFilter = emptyInserterFilterCommand(entity, def, db);
  if (emptyFilter) commands.push(emptyFilter);
  return commands;
}
