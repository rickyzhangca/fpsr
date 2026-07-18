import { buildPowerPoleDirections } from "../pole-orientation.js";
import type { Blueprint, BlueprintEntity } from "../types/blueprint.js";
import type { EntityRenderDef, RenderDb } from "../types/render-db.js";
import { type BeltOccupant, buildBeltTileIndex } from "./belts.js";
import { buildFluidPipeSides, buildHeatPipeSides } from "./pipes.js";
import { type NeighborGrid, buildNeighborGrid } from "./shared.js";

export interface LayerSelection {
  /** Index into def.graphics. */
  group: number;
  variantKey: string;
  index: number;
  /**
   * Extra tile-space shift applied on top of the sprite variant's shift
   * (used for belt starting/ending caps).
   */
  shift?: [number, number];
}

export interface ResolvedEntity {
  entity: BlueprintEntity;
  def: EntityRenderDef;
  selections: LayerSelection[];
}

export interface ResolveOptions {
  /** Emit belt starting/ending cap selections. Default true. */
  beltEndings?: boolean;
}

/** Shared neighbor indexes for one blueprint planning pass. */
export interface ResolveContext {
  blueprint: Blueprint;
  db: RenderDb;
  entities: BlueprintEntity[];
  grid: NeighborGrid;
  beltIndex: Map<string, BeltOccupant[]>;
  fluidPipeSides: Map<string, Set<string>>;
  /** Heat-pipe tile -> sides connected to a non-heat-pipe entity's heat port. */
  heatPipeSides?: Map<string, Set<string>>;
  poleDirs: Map<number, number>;
  /** Use platform cargo-bay body/connection art (hub or space-platform tiles). */
  preferPlatformGraphics: boolean;
}

/** Space-platform hub or foundation tiles → use platform cargo-bay art. */
export function blueprintPrefersPlatformGraphics(
  blueprint: Blueprint,
  entities: BlueprintEntity[] = blueprint.entities ?? [],
): boolean {
  if (entities.some((e) => e.name === "space-platform-hub")) return true;
  return (blueprint.tiles ?? []).some((t) => t.name.startsWith("space-platform-"));
}

/** Build indexes for an already migrated blueprint. */
export function createResolveContext(blueprint: Blueprint, db: RenderDb): ResolveContext {
  const entities = blueprint.entities ?? [];
  const grid = buildNeighborGrid(entities);
  const beltIndex = buildBeltTileIndex(entities, db);
  const fluidPipeSides = buildFluidPipeSides(entities, db);
  const heatPipeSides = buildHeatPipeSides(entities, db);
  const poleDirs = buildPowerPoleDirections(
    blueprint,
    entities,
    (entity) => db.entities[entity.name]?.protoType === "electric-pole",
  );
  const preferPlatformGraphics = blueprintPrefersPlatformGraphics(blueprint, entities);
  return {
    blueprint,
    db,
    entities,
    grid,
    beltIndex,
    fluidPipeSides,
    heatPipeSides,
    poleDirs,
    preferPlatformGraphics,
  };
}
