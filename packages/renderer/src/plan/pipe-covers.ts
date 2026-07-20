import { activeFluidOffsetEntries, activeFluidOffsets } from "../resolve/fluid-ports.js";
import { cardinalDirection } from "../resolve/shared.js";
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
 * Sprite4Way index for FluidBox.pipe_picture — matches connection facing
 * (FBSR: `defineSprites(..., facing)` where facing is the pipe-connection
 * direction). Cryo ±3 shifts are authored to cancel the pipe-tile anchor
 * back to entity center; do not flip to the opposite leaf.
 */
function pipePictureDirIndex(facing: 0 | 4 | 8 | 12): 0 | 1 | 2 | 3 {
  return (Math.floor(facing / 4) % 4) as 0 | 1 | 2 | 3;
}

function snapCardinalFacing(n: number | undefined, ox: number, oy: number): 0 | 4 | 8 | 12 {
  if (n === 0 || n === 4 || n === 8 || n === 12) return n;
  if (Math.abs(ox) >= Math.abs(oy)) return ox > 0 ? 4 : 12;
  return oy > 0 ? 8 : 0;
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
 * Draw fluid-box pipe covers on each active port's adjacent tile.
 * Factorio: `pipe_covers` seal open flanges; with `always_draw_covers` (default
 * true when the entity has no `pipe_picture`) they also draw on connected
 * ports — pumps need this because their north/south art is pre-cropped.
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

    // FBSR / Factorio: covers are sprites at the adjacent pipe tile. Y-sort by
    // that 1×1 tile (south edge = pipeY+0.5) so north covers sit above the
    // pipe but under the owning entity — entity sortY would paint the north
    // cap over pump bellows / machine faces.
    const alwaysDraw = alwaysDrawPipeCovers(def);
    for (const [ox, oy] of activeFluidOffsets(entity, def, db)) {
      const pipeX = entity.position.x + ox;
      const pipeY = entity.position.y + oy;
      // Cap when nothing is connected — unless always_draw_covers.
      if (!alwaysDraw && fluidPortOccupied(grid, db, pipeX, pipeY)) continue;

      const di = coverDirIndex(ox, oy);
      const cover = pc.covers[di];
      if (!cover) continue;

      const sortY = pipeY + 0.5;
      const sortX = pipeX;

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

/** Factorio FluidBox.always_draw_covers effective value for this entity. */
function alwaysDrawPipeCovers(def: EntityRenderDef): boolean {
  if (def.data?.alwaysDrawPipeCovers === true) return true;
  if (def.data?.alwaysDrawPipeCovers === false) return false;
  // Legacy DBs / omitted flag: default true when no pipe_picture art.
  return !def.data?.pipePictures?.some((p) => p != null);
}

/**
 * Draw FluidBox.pipe_picture stubs on each *active* fluid port.
 * Unlike covers, these draw whether or not a pipe is connected — they are the
 * machine-side pipe segment / face plate between the body and the cover/pipe.
 *
 * FBSR places both pipe_picture and pipe_covers at the adjacent pipe tile
 * (`facing.offset(connectionPos, 1)`) and selects Sprite4Way by connection
 * facing. Baked shifts then apply (cryo ±3 cancels back to entity center;
 * AM2 small shifts leave the stub at the opening).
 *
 * `pipePictures[i]` is parallel to `fluidConnections` indices.
 */
export function emitPipePictures(
  _bp: Blueprint,
  db: RenderDb,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  let b = bounds;

  for (const { entity, def } of byNumber.values()) {
    if (def.kind === "pipe" || def.protoType === "pipe-to-ground") continue;
    const pictures = def.data?.pipePictures;
    if (!pictures || !def.data?.fluidConnections) continue;

    const sortY = entity.position.y + def.collisionBox[1][1];
    const sortX = entity.position.x;
    const dirKey = String(cardinalDirection(entity.direction ?? 0));
    const facings = def.data.fluidConnectionFacings?.[dirKey];

    for (const { index, offset } of activeFluidOffsetEntries(entity, def, db)) {
      const pc = pictures[index];
      if (!pc?.covers) continue;
      const facing = snapCardinalFacing(facings?.[index], offset[0], offset[1]);
      const di = pipePictureDirIndex(facing);
      const picture = pc.covers[di];
      if (!picture) continue;

      // Pipe-tile anchor (same as covers / FBSR adjPos).
      const cx = entity.position.x + offset[0];
      const cy = entity.position.y + offset[1];

      const shadow = pc.shadows?.[di];
      if (shadow) {
        const sf = db.frames[shadow.frame];
        if (sf) {
          b = pushPipeCoverSprite(commands, b, entity, sf, shadow, cx, cy, sortY, sortX, 70);
        }
      }
      const pf = db.frames[picture.frame];
      if (pf) {
        b = pushPipeCoverSprite(commands, b, entity, pf, picture, cx, cy, sortY, sortX, 71);
      }
    }
  }
  return b;
}
