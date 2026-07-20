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
 * Pipe-tile offsets that are currently active for this entity's fluid boxes,
 * with connection indices parallel to `fluidConnections` / `pipePictures`.
 * Includes openings with `hide_connection_info` (covers/joints/pictures still apply).
 */
export function activeFluidOffsetEntries(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): { index: number; offset: [number, number] }[] {
  const fc = def.data?.fluidConnections;
  if (!fc) return [];
  const d = cardinalDirection(entity.direction ?? 0);
  const dirKey = String(d);
  const offsets = fc[dirKey] ?? [];
  if (offsets.length === 0) return [];

  const roles: FluidConnectionRole[] | undefined = def.data?.fluidConnectionRoles?.[dirKey];

  let indices: number[];
  if (!def.data?.fluidBoxesRequireFluidRecipe) {
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

  const out: { index: number; offset: [number, number] }[] = [];
  for (const i of indices) {
    const offset = offsets[i];
    if (!offset) continue;
    out.push({ index: i, offset });
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
  return activeFluidOffsetEntries(entity, def, db).map((e) => e.offset);
}

/** True when this entity has at least one active fluid port for the current recipe. */
export function hasActiveFluidPorts(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): boolean {
  return activeFluidOffsets(entity, def, db).length > 0;
}

/**
 * Fluid-box production roles that are active for the current recipe.
 * Used to gate foundry-style pipe working visualisations.
 */
export function activeFluidRoles(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): Set<FluidConnectionRole> {
  const roles = new Set<FluidConnectionRole>();
  if (!def.data?.fluidBoxesRequireFluidRecipe) {
    roles.add("input");
    roles.add("output");
    return roles;
  }
  const recipe = entity.recipe;
  if (!recipe) return roles;
  const flags: FluidRecipeFlags | undefined = db.fluidRecipes?.[recipe];
  if (!flags) return roles;
  if (flags.ingredients) roles.add("input");
  if (flags.products) roles.add("output");
  return roles;
}

/** Whether a graphics group gated by fluidWorkingVisualisationGroups should draw. */
export function isFluidWorkingVisualisationGroupActive(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
  group: number,
): boolean {
  const gated = def.data?.fluidWorkingVisualisationGroups;
  if (!gated) return true;
  const inInput = gated.input?.includes(group) === true;
  const inOutput = gated.output?.includes(group) === true;
  if (!inInput && !inOutput) return true;
  const active = activeFluidRoles(entity, def, db);
  if (inInput && active.has("input")) return true;
  if (inOutput && active.has("output")) return true;
  return false;
}
