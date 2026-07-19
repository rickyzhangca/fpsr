/**
 * Planner / resolve / draw-list subpath: `@rickyzhangca/fpsr/planner`.
 */

export { analyzePlan } from "./plan-diagnostics.js";
export type { PlanDiagnostics, UnsupportedBlueprintContent } from "./plan-diagnostics.js";

export { planDrawList, planDrawListWithOptions } from "./plan.js";
export type { PlanOptions, PlanResult } from "./plan.js";

export { resolve } from "./resolve.js";
export type {
  BeltOccupant,
  BeltReaderSlot,
  LayerSelection,
  ResolvedEntity,
  ResolveOptions,
  ResolveResult,
} from "./resolve.js";

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
