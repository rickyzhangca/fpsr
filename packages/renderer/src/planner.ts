/**
 * Planner / resolve / draw-list subpath: `@rickyzhangca/fpsr/planner`.
 */

export {
  altSignalFrame,
  planAltModeCommands,
  planRequestPinCommands,
  signalIconKeys,
} from "./alt-mode.js";

export { analyzePlan } from "./plan-diagnostics.js";
export type { PlanDiagnostics, UnsupportedBlueprintContent } from "./plan-diagnostics.js";

export {
  normalizeEntityColor,
  planDrawList,
  planDrawListWithOptions,
  tileMod,
  tileVariantHash,
  UNSUPPORTED_ENTITY_ICON_KEY,
} from "./plan.js";
export type { PlanOptions, PlanResult } from "./plan.js";

export {
  artilleryCannonShift,
  BELT_CONTENT_READ_ENTIRE,
  BELT_CURVE_LEFT,
  BELT_CURVE_RIGHT,
  BELT_END_INDEX,
  BELT_READER_BAND,
  BELT_READER_FRAME,
  BELT_START_INDEX,
  BELT_STRAIGHT_INDEX,
  beltCircuitConnectorFrame,
  beltCircuitConnectorVariation,
  beltConnectorBackPatchIndex,
  beltReaderSlots,
  blueprintPrefersPlatformGraphics,
  buildBeltTileIndex,
  cardinalDirection,
  collectBeltReaderEntities,
  createResolveContext,
  dir16ToIndex,
  isBeltCircuitInputEnabled,
  isBeltCircuitOutputEnabled,
  projectTrainOrientation,
  projectVehicleOrientation,
  railDirectionIndex,
  resolve,
  rotateOffset,
  trainOrientationIndex,
  trainRailShiftY,
  trainWheelShifts,
  UG_STRUCTURE_INDEX,
  undergroundStructureIndex,
} from "./resolve.js";
export type {
  BeltOccupant,
  BeltReaderSlot,
  LayerSelection,
  ResolvedEntity,
  ResolveOptions,
  ResolveResult,
} from "./resolve.js";

export {
  buildPowerPoleDirections,
  effectivePowerPoleDirection,
  powerPoleRotationFromNeighbors,
} from "./pole-orientation.js";

export {
  buildTrainChainGeometry,
  DEFAULT_CONNECTION_DISTANCE,
  DEFAULT_JOINT_DISTANCE,
  TRAIN_CHAIN_JOINT_RADIUS,
  trainJointWorldPoints,
} from "./train-chains.js";
export type { TrainChainGeometry, TrainJointPoints } from "./train-chains.js";

export { WIRE_CONNECTOR_ID, wireConnectorColor } from "./wire-connectors.js";
export type { WireColor } from "./wire-connectors.js";

export { drawListForTile } from "./tiled-draw-list.js";

export {
  DECONSTRUCTION_PLANNER_COLUMNS,
  planDeconstructionPlannerDrawList,
} from "./plan/deconstruction-planner.js";
export { planUpgradePlannerDrawList, UPGRADE_PLANNER_COLUMNS } from "./plan/upgrade-planner.js";

export {
  compareDrawCmd,
  FACTORIO_RENDER_LAYERS,
  RENDER_LAYERS,
  serializeDrawList,
} from "./types/draw-list.js";
export type {
  DrawCmd,
  DrawList,
  DrawListBounds,
  IconCmd,
  RectCmd,
  SnapGridCmd,
  SpriteCmd,
  TextCmd,
  TrainChainCmd,
  WireCmd,
} from "./types/draw-list.js";

export type { PlanProfile } from "./profile.js";
