import { type BeltOccupant, beltReaderSlots } from "../resolve.js";
import type { Blueprint, BlueprintEntity } from "../types/blueprint.js";
import { type DrawCmd, type DrawList, RENDER_LAYERS, type SpriteCmd } from "../types/draw-list.js";
import type {
  BeltReaderGraphics,
  EntityRenderDef,
  RenderDb,
  RenderLayerName,
} from "../types/render-db.js";
import { includeCmdBounds, spriteDest } from "./bounds.js";

/** Official belt_reader layers (already above transport-belt in Factorio enum). */
function paintBeltReaderLayer(official: RenderLayerName): number {
  return RENDER_LAYERS[official] ?? RENDER_LAYERS["transport-belt-reader"];
}

function beltReaderLayerOrder(name: RenderLayerName): number {
  return RENDER_LAYERS[name] ?? 0;
}

/**
 * Emit whole-belt-reader side skirts for entire_belt_hold lines.
 * Sheet is band×NESW; each belt may paint multiple edge frames.
 * Underground belts on the line get skirts too (under the hood).
 */
export function emitBeltReaders(
  bp: Blueprint,
  db: RenderDb,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  beltIndex: Map<string, BeltOccupant[]>,
  readerEntities: Set<number>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  if (readerEntities.size === 0) return bounds;
  let b = bounds;

  for (const entityNumber of readerEntities) {
    const entry = byNumber.get(entityNumber);
    if (!entry) continue;
    const { entity, def } = entry;
    if (def.kind !== "belt" && def.kind !== "underground-belt") continue;
    const graphics: BeltReaderGraphics | undefined = def.data?.beltReaderGraphics;
    if (!graphics?.layers?.length) continue;

    const slots = beltReaderSlots(entity, def, beltIndex, readerEntities);
    // Official order: endings < floor-mechanics < transport-belt-reader < object.
    // Skirts stay under UG hoods (object) so they appear to run through — same as in-game.
    const layers = [...graphics.layers].sort(
      (a, b) => beltReaderLayerOrder(a.layer) - beltReaderLayerOrder(b.layer),
    );

    // Per-entity sub (not global): sort is (layer, sortY, sortX, entity, sub), and belt
    // cages use sub≥50 on transport-belt-circuit-connector. A global counter
    // pushed later reader entities above 50 so skirts painted over cages.
    let sub = 10;

    for (const slot of slots) {
      for (const layer of layers) {
        const variant = layer.variants[slot.band]?.[slot.frame];
        if (!variant) continue;
        const frame = db.frames[variant.frame];
        if (!frame) continue;
        const dest = spriteDest(entity.position.x, entity.position.y, frame, variant, slot.shift);
        const isShadow = variant.drawAsShadow === true;
        const cmd: SpriteCmd = {
          kind: "sprite",
          layer: isShadow ? RENDER_LAYERS.shadow : paintBeltReaderLayer(layer.layer),
          sortY: 0,
          sortX: 0,
          entity: entity.entity_number,
          sub: sub++,
          frame: variant.frame,
          x: dest.x,
          y: dest.y,
          w: dest.w,
          h: dest.h,
        };
        if (variant.tint) cmd.tint = variant.tint;
        if (isShadow) cmd.shadow = true;
        // Slot flip (ending mirror) XOR variant flip from distill.
        if (Boolean(variant.flipX) !== Boolean(slot.flipX)) cmd.flipX = true;
        if (Boolean(variant.flipY) !== Boolean(slot.flipY)) cmd.flipY = true;
        if (variant.rotation) cmd.rotation = variant.rotation;
        commands.push(cmd);
        b = includeCmdBounds(b, cmd, db.frames);
      }
    }
  }
  return b;
}
