/**
 * Stable root export surface for `fpsr`.
 *
 * Prefer subpaths for deeper APIs:
 * - `fpsr/planner` — resolve / plan / draw-list diagnostics
 * - `fpsr/canvas` — Canvas2D execution and backgrounds
 * - `fpsr/render-db` — RenderDb / frame types
 * - `fpsr/node` — filesystem asset source (Node only)
 */

export {
  BlueprintSelectError,
  buildBookTree,
  listBlueprints,
  resolveActivePath,
  selectBlueprint,
  selectBook,
  selectUpgradePlanner,
} from "./book.js";
export type { BlueprintSelectReason, BookTree, BookTreeItem, BookTreeItemKind } from "./book.js";

export {
  asUpgradePlanner,
  UPGRADE_PLANNER_SLOT_COUNT,
  upgradePlannerIcons,
  upgradePlannerMappers,
} from "./upgrade-planner.js";
export type {
  UpgradeMapper,
  UpgradeMapperDestination,
  UpgradeMapperSource,
  UpgradePlanner,
} from "./upgrade-planner.js";

export { planUpgradePlannerDrawList, UPGRADE_PLANNER_COLUMNS } from "./plan/upgrade-planner.js";

export { BlueprintDecodeError, decode, decodeWithStats } from "./decode.js";
export type { BlueprintDecodeReason } from "./decode.js";
export { encode } from "./encode.js";

export type {
  AssetEvent,
  AssetEventKind,
  DecodeStats,
  DrawListStats,
  PlanProfile,
  RenderProfile,
} from "./profile.js";

export {
  BLUEPRINT_ADAPTERS,
  legacyItemsObjectToInsertPlans,
  migrateDocumentTo2x,
  migrateTo2x,
} from "./migrate.js";
export type { BlueprintAdapter } from "./migrate.js";

export { countBlueprintComponents } from "./blueprint-components.js";
export type { BlueprintComponentCount } from "./blueprint-components.js";

export {
  BLUEPRINT_ICON_TILE_SIZE,
  blueprintIconSignalCenter,
  blueprintIconSignalScale,
  blueprintIconSignalSizePx,
  blueprintIconSignalYOffsetPx,
  filledBlueprintIcons,
  planBlueprintIcons,
} from "./blueprint-icons.js";
export type {
  BlueprintIconPlan,
  BlueprintIconSignalPlan,
  BlueprintIconVariant,
  PlanBlueprintIconsOptions,
} from "./blueprint-icons.js";

export { resolveIconFrameId } from "./icon-resolve.js";

export {
  parseRichText,
  richTextIconKeys,
  richTextIconQuality,
  stripRichText,
} from "./rich-text.js";
export type { RichTextToken } from "./rich-text.js";

export { cdnAssets } from "./assets.js";
export type {
  AssetManifest,
  AssetSource,
  AssetTier,
  AssetTierManifest,
  CdnAssetsOptions,
} from "./assets.js";

export { computeTileFrame } from "./frame.js";
export type { TileFrame } from "./frame.js";

export { createStreamingPngEncoder } from "./png-stream.js";
export type { StreamingPngEncoder } from "./png-stream.js";
export {
  AssetDensityMismatchError,
  createRenderer,
  measureTileFrame,
  resolveSpacePlanetFrameId,
  UnknownTerrainBackgroundError,
} from "./renderer.js";
export type {
  CanvasLike,
  CreateCanvasFn,
  CreateRendererOptions,
  MaxOutputSize,
  MeasureOptions,
  RenderBackground,
  Renderer,
  RenderImageMimeType,
  RenderImageOptions,
  RenderMeasurement,
  RenderOptions,
  RenderProgressEvent,
  RenderResult,
  TiledPngOptions,
  TiledPngResult,
} from "./renderer.js";

export { decodeVersion } from "./types/blueprint.js";
export type {
  Blueprint,
  BlueprintBook,
  BlueprintBookEntry,
  BlueprintDocument,
  BlueprintEntity,
  BlueprintFilter,
  BlueprintInsertPlan,
  BlueprintInventory,
  BlueprintInventoryPosition,
  BlueprintItemInventoryPositions,
  BlueprintRef,
  BlueprintRollingStockConnection,
  BlueprintWire,
  Color,
  Icon,
  Position,
  SignalId,
  Tile,
} from "./types/blueprint.js";

export type { DrawCmd, DrawList, DrawListBounds } from "./types/draw-list.js";
export type { FrameId, FrameMeta, RenderDb } from "./types/render-db.js";

export type { AssetLoadOptions, ImageDataLike, ImageSource } from "./host.js";
