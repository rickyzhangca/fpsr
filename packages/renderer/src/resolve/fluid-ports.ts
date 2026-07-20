import type { BlueprintEntity } from "../types/blueprint.js";
import type {
  EntityRenderDef,
  FluidConnectionRole,
  FluidRecipeFlags,
  RenderDb,
} from "../types/render-db.js";
import { cardinalDirection } from "./shared.js";

/**
 * Pipe-tile offsets that are currently active for this entity's fluid boxes.
 *
 * When `fluidBoxesRequireFluidRecipe` is set (Factorio
 * `fluid_boxes_off_when_no_fluid_recipe`), ports only activate for recipes that
 * actually use fluid ingredients / products; input vs output is filtered by
 * `fluidConnectionRoles`.
 */
export function activeFluidOffsets(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): [number, number][] {
  const fc = def.data?.fluidConnections;
  if (!fc) return [];
  const d = cardinalDirection(entity.direction ?? 0);
  const dirKey = String(d);
  const offsets = fc[dirKey] ?? [];
  if (offsets.length === 0) return [];

  if (!def.data?.fluidBoxesRequireFluidRecipe) return offsets;

  const recipe = entity.recipe;
  if (!recipe) return [];
  const flags: FluidRecipeFlags | undefined = db.fluidRecipes?.[recipe];
  if (!flags || (!flags.ingredients && !flags.products)) return [];

  const roles: FluidConnectionRole[] | undefined = def.data.fluidConnectionRoles?.[dirKey];
  if (!roles || roles.length !== offsets.length) {
    // Roles missing (older DB): any fluid recipe activates all ports.
    return offsets;
  }

  const out: [number, number][] = [];
  for (let i = 0; i < offsets.length; i++) {
    const role = roles[i];
    const offset = offsets[i];
    if (!role || !offset) continue;
    if (role === "input" && flags.ingredients) out.push(offset);
    else if (role === "output" && flags.products) out.push(offset);
  }
  return out;
}

/** True when this entity has at least one active fluid port for the current recipe. */
export function hasActiveFluidPorts(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): boolean {
  return activeFluidOffsets(entity, def, db).length > 0;
}
