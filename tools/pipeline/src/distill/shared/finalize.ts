import { createHash } from "node:crypto";
import { guessedLayer } from "../../render-layers.js";
import { type FrameBank } from "../../sprite.js";
import type { EntityRenderDef, SpriteVariant } from "../../types.js";
import { withBeltConnectorGraphics, withBeltReaderGraphics } from "./belt-connectors.js";
import { boxOf } from "./box.js";
import { withPipeCovers, withPipePictures } from "./pipe.js";
import { withCircuitConnectorGraphics, withWireAnchors } from "./wire.js";

export async function addPlaceholderVariant(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<SpriteVariant> {
  const box = boxOf(p, "selection_box");
  const tileW = Math.max(0.25, box[1][0] - box[0][0] || 1);
  const tileH = Math.max(0.25, box[1][1] - box[0][1] || 1);
  const sw = Math.max(1, Math.round(tileW * 32));
  const sh = Math.max(1, Math.round(tileH * 32));
  const rgba = Buffer.alloc(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    rgba[i * 4] = 140;
    rgba[i * 4 + 1] = 140;
    rgba[i * 4 + 2] = 150;
    rgba[i * 4 + 3] = 140;
  }
  const hash = createHash("sha256").update(rgba).update(`ph:${sw}x${sh}`).digest("hex");
  const frameId = await bank.add({ sw, sh, ox: 0, oy: 0, rgba, tw: sw, th: sh, hash });
  return { frame: frameId, scale: 1, shift: [0, 0] };
}

export function hasUsableGraphics(def: EntityRenderDef): boolean {
  for (const g of def.graphics) {
    for (const arr of Object.values(g.variants)) {
      if (arr.some((v) => v != null)) return true;
    }
  }
  return false;
}

export async function withPlaceholderIfEmpty(
  bank: FrameBank,
  p: Record<string, unknown>,
  def: EntityRenderDef,
  reason: string,
  placeholders: { name: string; reason: string }[],
  name: string,
): Promise<EntityRenderDef> {
  if (hasUsableGraphics(def)) return def;
  const variant = await addPlaceholderVariant(bank, p);
  placeholders.push({ name, reason });
  return {
    ...def,
    graphics: [
      {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        variants: { default: [variant] },
      },
    ],
    data: { ...def.data, placeholder: true, placeholderReason: reason },
  };
}

export async function finalizeEntityDef(
  bank: FrameBank,
  p: Record<string, unknown>,
  def: EntityRenderDef,
  placeholders: { name: string; reason: string }[],
  name: string,
  emptyReason: string,
): Promise<EntityRenderDef> {
  let finalized = await withPlaceholderIfEmpty(bank, p, def, emptyReason, placeholders, name);
  finalized = withWireAnchors(finalized, p);
  finalized = await withCircuitConnectorGraphics(bank, finalized, p);
  finalized = await withBeltConnectorGraphics(bank, finalized, p);
  finalized = await withBeltReaderGraphics(bank, finalized, p);
  finalized = await withPipeCovers(bank, finalized, p);
  return withPipePictures(bank, finalized, p);
}
