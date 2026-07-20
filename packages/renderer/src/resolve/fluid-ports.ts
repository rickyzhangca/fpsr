import type { BlueprintEntity } from "../types/blueprint.js";
import type {
  EntityRenderDef,
  FluidConnectionFlow,
  FluidConnectionRole,
  FluidRecipeFlags,
  RenderDb,
} from "../types/render-db.js";
import { cardinalDirection } from "./shared.js";

/** Cardinal facing used by fluid indication arrows (`0|4|8|12`). */
export type FluidPortFacing = 0 | 4 | 8 | 12;

/** One active fluid opening after recipe gating and hide_connection_info. */
export interface ActiveFluidPort {
  /** Pipe-tile offset relative to entity center. */
  offset: [number, number];
  flow: FluidConnectionFlow;
  facing: FluidPortFacing;
}

function snapFacing(n: number | undefined): FluidPortFacing {
  const v = n ?? 0;
  if (v === 4 || v === 8 || v === 12) return v;
  return 0;
}

function facingFromOffset(ox: number, oy: number): FluidPortFacing {
  if (Math.abs(ox) >= Math.abs(oy)) return ox > 0 ? 4 : 12;
  return oy > 0 ? 8 : 0;
}

/**
 * Active fluid openings for this entity (recipe-gated, hide_connection_info dropped).
 *
 * When `fluidBoxesRequireFluidRecipe` is set (Factorio
 * `fluid_boxes_off_when_no_fluid_recipe`), ports only activate for recipes that
 * actually use fluid ingredients / products; input vs output is filtered by
 * `fluidConnectionRoles`.
 */
export function activeFluidPorts(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): ActiveFluidPort[] {
  const data = def.data;
  const fc = data?.fluidConnections;
  if (!fc) return [];
  const d = cardinalDirection(entity.direction ?? 0);
  const dirKey = String(d);
  const offsets = fc[dirKey] ?? [];
  if (offsets.length === 0) return [];

  const roles: FluidConnectionRole[] | undefined = data.fluidConnectionRoles?.[dirKey];
  const flows = data.fluidConnectionFlows?.[dirKey];
  const facings = data.fluidConnectionFacings?.[dirKey];
  const hideInfo = data.fluidConnectionHideInfo?.[dirKey];

  let indices: number[];
  if (!data.fluidBoxesRequireFluidRecipe) {
    indices = offsets.map((_, i) => i);
  } else {
    const recipe = entity.recipe;
    if (!recipe) return [];
    const flags: FluidRecipeFlags | undefined = db.fluidRecipes?.[recipe];
    if (!flags || (!flags.ingredients && !flags.products)) return [];

    if (!roles || roles.length !== offsets.length) {
      // Roles missing (older DB): any fluid recipe activates all ports.
      indices = offsets.map((_, i) => i);
    } else {
      indices = [];
      for (let i = 0; i < offsets.length; i++) {
        const role = roles[i];
        if (!role) continue;
        if (role === "input" && flags.ingredients) indices.push(i);
        else if (role === "output" && flags.products) indices.push(i);
      }
    }
  }

  const out: ActiveFluidPort[] = [];
  for (const i of indices) {
    if (hideInfo?.[i] === true) continue;
    const offset = offsets[i];
    if (!offset) continue;
    const flow: FluidConnectionFlow =
      flows?.[i] === "input" || flows?.[i] === "output" || flows?.[i] === "input-output"
        ? flows[i]!
        : roles?.[i] === "output"
          ? "output"
          : roles?.[i] === "input"
            ? "input"
            : "input-output";
    const facing =
      facings && facings.length === offsets.length
        ? snapFacing(facings[i])
        : facingFromOffset(offset[0], offset[1]);
    out.push({ offset, flow, facing });
  }
  return out;
}

/**
 * Pipe-tile offsets that are currently active for this entity's fluid boxes.
 * Includes openings with `hide_connection_info` (covers/joints still apply).
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
