export {
  BlueprintSelectError,
  buildBookTree,
  listBlueprints,
  resolveActivePath,
  selectBlueprint,
  selectBook,
} from "./book.js";
export type { BlueprintSelectReason, BookTree, BookTreeItem, BookTreeItemKind } from "./book.js";
export { BlueprintDecodeError, decode, decodeWithStats } from "./decode.js";
export type { BlueprintDecodeReason } from "./decode.js";
export { encode } from "./encode.js";

export { nowMs, perfMark, perfMeasure } from "./profile.js";
export type {
  AssetEvent,
  AssetEventKind,
  DecodeStats,
  DrawListStats,
  PlanProfile,
  RenderProfile,
} from "./profile.js";

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
} from "./resolve.js";

export {
  BLUEPRINT_ADAPTERS,
  legacyItemsObjectToInsertPlans,
  migrateDocumentTo2x,
  migrateTo2x,
} from "./migrate.js";
export type { BlueprintAdapter } from "./migrate.js";

export {
  altSignalFrame,
  planAltModeCommands,
  planRequestPinCommands,
  signalIconKeys,
} from "./alt-mode.js";
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
export { analyzePlan } from "./plan-diagnostics.js";
export type { PlanDiagnostics, UnsupportedBlueprintContent } from "./plan-diagnostics.js";
export {
  normalizeEntityColor,
  planDrawList,
  tileMod,
  tileVariantHash,
  UNSUPPORTED_ENTITY_ICON_KEY,
} from "./plan.js";
export type { PlanOptions } from "./plan.js";
export {
  parseRichText,
  richTextIconKeys,
  richTextIconQuality,
  stripRichText,
} from "./rich-text.js";
export type { RichTextToken } from "./rich-text.js";

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

export { cdnAssets } from "./assets.js";
export type {
  AssetManifest,
  AssetSource,
  AssetTier,
  AssetTierManifest,
  CdnAssetsOptions,
} from "./assets.js";

export { executeDrawList } from "./canvas2d.js";
export type {
  Canvas2DContextLike,
  ExecuteDrawListOptions,
  ExecuteDrawListStats,
} from "./canvas2d.js";

export {
  bakeEntityInfoSilhouette,
  ENTITY_INFO_SILHOUETTE_BLUR_PX,
  ENTITY_INFO_SILHOUETTE_RADIUS_PX,
  entityInfoSilhouettePadPx,
} from "./icon-silhouette.js";

export { drawCoordinateOverlay } from "./coordinate-overlay.js";

export { computeTileFrame } from "./frame.js";
export type { TileFrame } from "./frame.js";

export { blitWithTileCheckerboard, drawTileCheckerboard } from "./checkerboard.js";
export { drawSpaceBackground, drawSpacePlanet } from "./space-background.js";
export type { DrawSpaceBackgroundOptions, SpacePlanetDecoration } from "./space-background.js";
export { drawTerrainBackground } from "./terrain-background.js";
export type { DrawTerrainBackgroundOptions } from "./terrain-background.js";

export { createRenderer, measureTileFrame, resolveSpacePlanetFrameId } from "./renderer.js";
export { createStreamingPngEncoder } from "./png-stream.js";
export type { StreamingPngEncoder } from "./png-stream.js";
export { drawListForTile } from "./tiled-draw-list.js";
export type {
  CanvasLike,
  CreateCanvasFn,
  CreateRendererOptions,
  MaxOutputSize,
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
  SpriteCmd,
  TrainChainCmd,
  WireCmd,
} from "./types/draw-list.js";

export type {
  AtlasMeta,
  BeltConnectorGraphics,
  BeltReaderGraphics,
  CargoBayConnectionCell,
  CargoBayConnectionLayer,
  CargoBayConnections,
  CombinatorGraphics,
  DirectionalConnectionMap,
  EntityKind,
  EntityRenderData,
  EntityRenderDef,
  FactorioRenderLayerName,
  FpsrRenderLayerName,
  FrameId,
  FrameMeta,
  LayerGroup,
  PipeCoverGraphics,
  RenderDb,
  RenderLayerName,
  SpaceBackground,
  SpriteVariant,
  TerrainBackgroundName,
  TerrainBackgrounds,
  TerrainPatchBackground,
  TerrainPatchSet,
  TileMaterialAtlas,
  TileRenderDef,
  WireAnchorMap,
  WireAnchorSet,
  WireConnectorGraphics,
  WireConnectorLayerName,
} from "./types/render-db.js";
