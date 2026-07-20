import { migrateTo2x } from "../migrate.js";
import type { Blueprint, BlueprintEntity } from "../types/blueprint.js";
import type { EntityRenderDef, LayerGroup, RenderDb } from "../types/render-db.js";
import {
  BELT_END_INDEX,
  BELT_START_INDEX,
  type BeltOccupant,
  beltCapShift,
  beltCurveIndex,
  hasBeltConsumer,
  hasBeltConsumerAt,
  hasBeltFeeder,
  hasBeltFeederAt,
  hasOpenSideFeeder,
  undergroundStructureIndex,
} from "./belts.js";
import {
  type LayerSelection,
  type ResolveContext,
  type ResolveOptions,
  type ResolvedEntity,
  createResolveContext,
} from "./context.js";
import { isFluidWorkingVisualisationGroupActive } from "./fluid-ports.js";
import {
  buildHeatPipeSides,
  buildHeatPortGrid,
  heatPipeMask,
  heatPortConnected,
  heatPortDirection,
  pipeMask,
} from "./pipes.js";
import {
  DIR_DELTA,
  type NeighborGrid,
  cardinalDirection,
  dir16ToIndex,
  rotateOffset,
} from "./shared.js";
import {
  artilleryCannonShift,
  projectTrainOrientation,
  projectVehicleOrientation,
  trainOrientationIndex,
  trainRailShiftY,
  trainWheelShifts,
} from "./trains.js";
import { gateVariantKey, wallMask } from "./walls.js";

export {
  BELT_CONTENT_READ_ENTIRE,
  BELT_CURVE_LEFT,
  BELT_CURVE_RIGHT,
  BELT_END_INDEX,
  BELT_READER_BAND,
  BELT_READER_FRAME,
  BELT_START_INDEX,
  BELT_STRAIGHT_INDEX,
  UG_STRUCTURE_INDEX,
  beltCircuitConnectorFrame,
  beltCircuitConnectorVariation,
  beltConnectorBackPatchIndex,
  beltReaderSlots,
  buildBeltTileIndex,
  collectBeltReaderEntities,
  isBeltCircuitInputEnabled,
  isBeltCircuitOutputEnabled,
  undergroundStructureIndex,
  type BeltOccupant,
  type BeltReaderSlot,
} from "./belts.js";
export {
  blueprintPrefersPlatformGraphics,
  createResolveContext,
  type LayerSelection,
  type ResolveContext,
  type ResolveOptions,
  type ResolvedEntity,
} from "./context.js";
export { cardinalDirection, dir16ToIndex, rotateOffset } from "./shared.js";
export {
  artilleryCannonShift,
  projectTrainOrientation,
  projectVehicleOrientation,
  railDirectionIndex,
  trainOrientationIndex,
  trainRailShiftY,
  trainWheelShifts,
} from "./trains.js";

function variantKeyFor(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  grid: NeighborGrid,
  db: RenderDb,
  fluidPipeSides: Map<string, Set<string>>,
  heatPipeSides: Map<string, Set<string>>,
  opts?: { preferPlatformGraphics?: boolean },
): string {
  switch (def.kind) {
    case "underground-belt":
    case "loader":
      return entity.type === "output" ? "out" : "in";
    case "pipe":
      return pipeMask(entity, grid, db, fluidPipeSides);
    case "heat-pipe":
      return heatPipeMask(entity, grid, db, heatPipeSides);
    case "wall":
      return wallMask(entity, grid, db);
    case "gate":
      return gateVariantKey(entity);
    default:
      if (
        opts?.preferPlatformGraphics &&
        def.graphics.some((g) => g.variants.platform !== undefined)
      ) {
        return "platform";
      }
      return "default";
  }
}

function indexFor(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  group: LayerGroup,
  beltIndex: Map<string, BeltOccupant[]>,
  poleDirs?: Map<number, number>,
): number {
  if (def.kind === "vehicle") {
    const n =
      (typeof def.data?.orientationCount === "number" && def.data.orientationCount > 0
        ? def.data.orientationCount
        : group.variants.default?.length) ?? 1;
    return trainOrientationIndex(projectVehicleOrientation(entity.orientation ?? 0), n);
  }
  if (def.kind === "train") {
    const n =
      (typeof def.data?.orientationCount === "number" && def.data.orientationCount > 0
        ? def.data.orientationCount
        : group.variants.default?.length) ?? 1;
    const projected = projectTrainOrientation(entity.orientation ?? 0);
    const groupIndex = def.graphics.indexOf(group);
    const isWheels =
      typeof def.data?.wheelsGroupIndex === "number" && groupIndex === def.data.wheelsGroupIndex;
    // Cargo/fluid wagon bodies use back_equals_front; wheel sheets do not.
    return trainOrientationIndex(projected, n, def.data?.backEqualsFront === true && !isWheels);
  }
  const direction =
    def.protoType === "electric-pole" && poleDirs?.has(entity.entity_number)
      ? (poleDirs.get(entity.entity_number) ?? 0)
      : (entity.direction ?? 0);
  if (group.indexing === "resolver") {
    if (def.kind === "belt") {
      return beltCurveIndex(entity, beltIndex);
    }
    return dir16ToIndex(direction, "direction4");
  }
  if (
    (group.layer === "object" || group.layer === "object-under") &&
    (def.kind === "underground-belt" || def.kind === "loader") &&
    group.indexing === "direction4"
  ) {
    return undergroundStructureIndex(entity.direction ?? 0, entity.type);
  }
  // Inserter platform sheet faces the drop side; FBE samples ((dir+8)%16)/4.
  // Hands use entity facing (pickup). Platform is always graphics[0].
  if (def.kind === "inserter" && group.indexing === "direction4" && def.graphics[0] === group) {
    return (dir16ToIndex(entity.direction ?? 0, "direction4") + 2) % 4;
  }
  return dir16ToIndex(direction, group.indexing);
}

export function resolveWithContext(
  context: ResolveContext,
  warningsOut?: string[],
  opts?: ResolveOptions,
): ResolvedEntity[] {
  const beltEndings = opts?.beltEndings ?? true;
  const { beltIndex, db, entities, fluidPipeSides, grid, poleDirs, preferPlatformGraphics } =
    context;
  const heatPipeSides = context.heatPipeSides ?? buildHeatPipeSides(entities, db);
  const heatPorts = buildHeatPortGrid(entities, db);
  const out: ResolvedEntity[] = [];

  for (const entity of entities) {
    const def = db.entities[entity.name];
    if (!def) {
      warningsOut?.push(`Unknown entity "${entity.name}" (entity_number=${entity.entity_number})`);
      continue;
    }

    const variantKey = variantKeyFor(entity, def, grid, db, fluidPipeSides, heatPipeSides, {
      preferPlatformGraphics,
    });
    const selections: LayerSelection[] = [];

    for (let group = 0; group < def.graphics.length; group++) {
      const layerGroup = def.graphics[group];
      if (!layerGroup) continue;

      if (!isFluidWorkingVisualisationGroupActive(entity, def, db, group)) {
        continue;
      }

      if (def.data?.heatConnectionPatchGroupIndices?.includes(group)) {
        const d = cardinalDirection(entity.direction);
        for (const [portIndex, targetOffset] of (
          def.data.heatConnections?.[String(d)] ?? []
        ).entries()) {
          const direction = heatPortDirection(targetOffset[0], targetOffset[1]);
          const [dx, dy] = DIR_DELTA[direction];
          selections.push({
            group,
            variantKey: heatPortConnected(entity, targetOffset, heatPorts, grid, db)
              ? "connected"
              : "disconnected",
            index: portIndex,
            shift: [targetOffset[0] - dx, targetOffset[1] - dy],
          });
        }
        continue;
      }

      const index = indexFor(entity, def, layerGroup, beltIndex, poleDirs);
      const key =
        layerGroup.variants[variantKey] !== undefined
          ? variantKey
          : layerGroup.variants.default !== undefined
            ? "default"
            : variantKey;

      // Rolling stock: two bogies at ±jointDistance/2 (not a single centered sprite).
      if (def.kind === "train" && group === def.data?.wheelsGroupIndex) {
        const joint =
          typeof def.data?.jointDistance === "number" && def.data.jointDistance > 0
            ? def.data.jointDistance
            : 4;
        const n =
          (typeof def.data?.orientationCount === "number" && def.data.orientationCount > 0
            ? def.data.orientationCount
            : layerGroup.variants.default?.length) ?? 1;
        for (const bogie of trainWheelShifts(entity.orientation ?? 0, joint)) {
          selections.push({
            group,
            variantKey: key,
            index: trainOrientationIndex(bogie.orientation, n),
            shift: bogie.shift,
          });
        }
        continue;
      }

      // Splitters: two lane underlays at ±0.5 perpendicular to facing (FBE),
      // plus start/end caps per lane when that side is open.
      if (def.kind === "splitter" && layerGroup.layer === "transport-belt") {
        const dir = cardinalDirection(entity.direction);
        const dir4 = dir16ToIndex(entity.direction ?? 0, "direction4");
        const lanes: [number, number][] = [rotateOffset(-0.5, 0, dir), rotateOffset(0.5, 0, dir)];
        for (const lane of lanes) {
          selections.push({
            group,
            variantKey: key,
            index,
            shift: lane,
          });
          if (!beltEndings) continue;
          const lx = entity.position.x + lane[0];
          const ly = entity.position.y + lane[1];
          if (layerGroup.variants.start && !hasBeltFeederAt(lx, ly, dir, beltIndex)) {
            const [sx, sy] = beltCapShift(dir, "start");
            selections.push({
              group,
              variantKey: "start",
              index: dir4,
              shift: [lane[0] + sx, lane[1] + sy],
            });
          }
          if (layerGroup.variants.end && !hasBeltConsumerAt(lx, ly, dir, beltIndex)) {
            const [ex, ey] = beltCapShift(dir, "end");
            selections.push({
              group,
              variantKey: "end",
              index: dir4,
              shift: [lane[0] + ex, lane[1] + ey],
            });
          }
        }
        continue;
      }

      // UG/loader: straight underlay + open-side wrap cap when that side is open
      // (no behind feeder into an input / no consumer after an output). Side-loads
      // do not seal the open half. Connected open sides stay continuous — no cap.
      if (
        (def.kind === "underground-belt" || def.kind === "loader") &&
        layerGroup.layer === "transport-belt"
      ) {
        selections.push({ group, variantKey: key, index });
        if (beltEndings) {
          const dir = cardinalDirection(entity.direction);
          const dir4 = dir16ToIndex(entity.direction ?? 0, "direction4");
          const isOutput = entity.type === "output";
          if (!isOutput && layerGroup.variants.start && !hasOpenSideFeeder(entity, beltIndex)) {
            selections.push({
              group,
              variantKey: "start",
              index: dir4,
              shift: beltCapShift(dir, "start"),
            });
          }
          if (isOutput && layerGroup.variants.end && !hasBeltConsumer(entity, beltIndex)) {
            selections.push({
              group,
              variantKey: "end",
              index: dir4,
              shift: beltCapShift(dir, "end"),
            });
          }
        }
        continue;
      }

      if (def.kind === "train") {
        const railY = trainRailShiftY(entity.orientation ?? 0);
        const cannonIdxs = def.data?.cannonGroupIndices;
        if (Array.isArray(cannonIdxs) && cannonIdxs.includes(group)) {
          const [cx, cy] = artilleryCannonShift(entity.orientation ?? 0, {
            cannonBaseHeight:
              typeof def.data?.cannonBaseHeight === "number"
                ? def.data.cannonBaseHeight
                : undefined,
            cannonBaseShiftWhenVertical:
              typeof def.data?.cannonBaseShiftWhenVertical === "number"
                ? def.data.cannonBaseShiftWhenVertical
                : undefined,
            cannonBaseShiftWhenHorizontal:
              typeof def.data?.cannonBaseShiftWhenHorizontal === "number"
                ? def.data.cannonBaseShiftWhenHorizontal
                : undefined,
            orientationCount:
              typeof def.data?.orientationCount === "number"
                ? def.data.orientationCount
                : undefined,
          });
          selections.push({
            group,
            variantKey: key,
            index,
            shift: [cx, cy + railY],
          });
        } else {
          selections.push({ group, variantKey: key, index, shift: [0, railY] });
        }
        continue;
      }

      selections.push({ group, variantKey: key, index });

      if (
        beltEndings &&
        def.kind === "belt" &&
        layerGroup.indexing === "resolver" &&
        (layerGroup.variants[key]?.length ?? 0) >= 20
      ) {
        const dir = cardinalDirection(entity.direction);
        if (!hasBeltFeeder(entity, beltIndex)) {
          selections.push({
            group,
            variantKey: key,
            index: BELT_START_INDEX[dir],
            shift: beltCapShift(dir, "start"),
          });
        }
        if (!hasBeltConsumer(entity, beltIndex)) {
          selections.push({
            group,
            variantKey: key,
            index: BELT_END_INDEX[dir],
            shift: beltCapShift(dir, "end"),
          });
        }
      }
    }

    out.push({ entity, def, selections });
  }

  return out;
}

export function resolve(bp: Blueprint, db: RenderDb, opts?: ResolveOptions): ResolveResult {
  const warnings: string[] = [];
  const entities = resolveWithContext(createResolveContext(migrateTo2x(bp), db), warnings, opts);
  return { entities, warnings };
}

export interface ResolveResult {
  entities: ResolvedEntity[];
  warnings: string[];
}
