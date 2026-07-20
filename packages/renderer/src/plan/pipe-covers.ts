import { activeFluidOffsets } from "../resolve/fluid-ports.js";
import type { Blueprint, BlueprintEntity } from "../types/blueprint.js";
import { type DrawCmd, type DrawList, RENDER_LAYERS, type SpriteCmd } from "../types/draw-list.js";
import type {
  EntityRenderDef,
  FrameMeta,
  PipeCoverGraphics,
  RenderDb,
  RenderLayerName,
  SpriteVariant,
} from "../types/render-db.js";
import { includeCmdBounds, spriteDest } from "./bounds.js";

/** Tile-center key matching resolve.ts neighbor grid. */
function tileKey(x: number, y: number): string {
  return `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
}

function buildEntityGrid(entities: BlueprintEntity[]): Map<string, BlueprintEntity[]> {
  const grid = new Map<string, BlueprintEntity[]>();
  for (const e of entities) {
    const key = tileKey(e.position.x, e.position.y);
    const list = grid.get(key);
    if (list) list.push(e);
    else grid.set(key, [e]);
  }
  return grid;
}

/** direction4 index (N=0,E=1,S=2,W=3) from entity→pipe-tile offset. */
function coverDirIndex(ox: number, oy: number): 0 | 1 | 2 | 3 {
  if (Math.abs(ox) >= Math.abs(oy)) return ox > 0 ? 1 : 3;
  return oy > 0 ? 2 : 0;
}

/**
 * True when the adjacent port tile has a pipe / pipe-to-ground / fluid entity
 * with an *active* fluid port targeting this tile.
 */
function fluidPortOccupied(
  grid: Map<string, BlueprintEntity[]>,
  db: RenderDb,
  pipeX: number,
  pipeY: number,
): boolean {
  const neighbors = grid.get(tileKey(pipeX, pipeY));
  if (!neighbors) return false;
  for (const n of neighbors) {
    const nd = db.entities[n.name];
    if (!nd) continue;
    if (nd.kind === "pipe") return true;
    if (nd.protoType === "pipe-to-ground" || n.name === "pipe-to-ground") return true;
    if (!nd.data?.fluidConnections) continue;
    for (const [ox, oy] of activeFluidOffsets(n, nd, db)) {
      if (
        Math.abs(n.position.x + ox - pipeX) < 0.01 &&
        Math.abs(n.position.y + oy - pipeY) < 0.01
      ) {
        return true;
      }
    }
  }
  return false;
}

function pushPipeCoverSprite(
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
  entity: BlueprintEntity,
  frame: FrameMeta,
  variant: SpriteVariant,
  cx: number,
  cy: number,
  sortY: number,
  sortX: number,
  sub: number,
): DrawList["bounds"] {
  const dest = spriteDest(cx, cy, frame, variant);
  // Unconnected caps sit on `object` (FBSR Layer.OBJECT at the adjacent tile).
  const layerName: RenderLayerName = variant.drawAsShadow ? "shadow" : "object";
  const cmd: SpriteCmd = {
    kind: "sprite",
    layer: RENDER_LAYERS[layerName],
    sortY: variant.drawAsShadow ? 0 : sortY,
    sortX: variant.drawAsShadow ? 0 : sortX,
    entity: entity.entity_number,
    sub,
    frame: variant.frame,
    x: dest.x,
    y: dest.y,
    w: dest.w,
    h: dest.h,
  };
  if (variant.drawAsShadow) cmd.shadow = true;
  commands.push(cmd);
  return includeCmdBounds(bounds, cmd, undefined, frame);
}

/**
 * Draw fluid-box pipe covers on each *unconnected* port's adjacent tile.
 * Factorio: `pipe_covers` are "the pictures to show when no FluidBox is
 * connected" — caps sealing open flanges (FBSR: `!isPipeConnected`).
 *
 * Assemblers with `fluidBoxesRequireFluidRecipe` only emit covers for ports
 * activated by the current recipe's fluid ingredients/products.
 */
export function emitPipeCovers(
  bp: Blueprint,
  db: RenderDb,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const grid = buildEntityGrid(bp.entities ?? []);
  let b = bounds;

  for (const { entity, def } of byNumber.values()) {
    // Pipes already draw their own joints; covers are for machine fluid-box flanges.
    if (def.kind === "pipe" || def.protoType === "pipe-to-ground") continue;
    const pc: PipeCoverGraphics | undefined = def.data?.pipeCovers;
    if (!pc?.covers || !def.data?.fluidConnections) continue;

    // Match owning entity y-sort so covers composite with the machine cut.
    const sortY = entity.position.y + def.collisionBox[1][1];
    const sortX = entity.position.x;
    for (const [ox, oy] of activeFluidOffsets(entity, def, db)) {
      const pipeX = entity.position.x + ox;
      const pipeY = entity.position.y + oy;
      // Cap only when nothing is connected on this port.
      if (fluidPortOccupied(grid, db, pipeX, pipeY)) continue;

      const di = coverDirIndex(ox, oy);
      const cover = pc.covers[di];
      if (!cover) continue;

      const shadow = pc.shadows?.[di];
      if (shadow) {
        const sf = db.frames[shadow.frame];
        if (sf) {
          b = pushPipeCoverSprite(commands, b, entity, sf, shadow, pipeX, pipeY, sortY, sortX, 80);
        }
      }
      const cf = db.frames[cover.frame];
      if (cf) {
        b = pushPipeCoverSprite(commands, b, entity, cf, cover, pipeX, pipeY, sortY, sortX, 81);
      }
    }
  }
  return b;
}
