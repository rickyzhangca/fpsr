import { asOffset2, splitBeltFrameMain } from "../../belt-connector-split.js";
import { cropSpriteFrame, leafLayers, normalizeShift, type FrameBank } from "../../sprite.js";
import { guessedLayer, officialLayer } from "../../render-layers.js";
import type {
  BeltConnectorGraphics,
  BeltReaderGraphics,
  EntityRenderDef,
  RawSprite,
  RenderLayerName,
  SpriteVariant,
} from "../../types.js";
import { resolveCircuitConnectorList } from "./wire.js";

export const BELT_CONNECTOR_FRAME_KEYS = [
  "frame_shadow",
  "frame_main",
  "frame_back_patch",
] as const;
export const BELT_CONNECTOR_LED_KEYS = ["led_red", "led_green", "led_blue"] as const;

export type BeltConnectorFrameSprites = Partial<
  Record<(typeof BELT_CONNECTOR_FRAME_KEYS)[number], { sheet?: RawSprite } | RawSprite>
>;

/**
 * Distill transport-belt connector_frame_sprites + circuit_connector LED sprites.
 * Frame sheets are AnimationVariations (7 topology × 4 behavior-state frames).
 * The state frame is a bitmask: none=0, enable/output=1, read/input=2, both=3.
 * Back patch is SpriteVariations (3). LEDs are per-topology baked sprites.
 *
 * `frame_main` is split into clean cage+pegs plus `wire_horizontal` /
 * `wire_vertical` décor (Factorio masks these in-engine by enable/read).
 */
export async function distillBeltConnectorGraphics(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<BeltConnectorGraphics | undefined> {
  const cfs = p.connector_frame_sprites as BeltConnectorFrameSprites | undefined;
  if (!cfs) return undefined;

  const layers: BeltConnectorGraphics["layers"] = {};
  const list = resolveCircuitConnectorList(p);

  for (const key of BELT_CONNECTOR_FRAME_KEYS) {
    const entry = cfs[key];
    if (!entry) continue;
    const sheet = ("sheet" in entry && entry.sheet ? entry.sheet : entry) as RawSprite;
    if (!sheet.filename && !sheet.filenames) continue;
    const variationCount = sheet.variation_count ?? 1;
    const frameCount = sheet.frame_count ?? 1;
    if (frameCount <= 1) {
      // SpriteVariations (back_patch): one variant per variation index.
      const variants: (SpriteVariant | null)[] = [];
      for (let v = 0; v < variationCount; v++) {
        const info = await bank.addSprite(sheet, 0, v);
        variants.push(bank.toVariant(info));
      }
      if (key === "frame_back_patch") layers.frame_back_patch = variants;
      else if (key === "frame_main") layers.frame_main = variants.map((variant) => [variant]);
      else layers.frame_shadow = variants.map((variant) => [variant]);
      continue;
    }

    // AnimationVariations: [variation][directionFrame].
    const grid: (SpriteVariant | null)[][] = [];
    const wireHGrid: (SpriteVariant | null)[][] = [];
    const wireVGrid: (SpriteVariant | null)[][] = [];
    const splitMain = key === "frame_main";
    const shift = normalizeShift(sheet.shift);
    const scale = sheet.scale ?? 1;

    for (let v = 0; v < variationCount; v++) {
      const row: (SpriteVariant | null)[] = [];
      const hRow: (SpriteVariant | null)[] = [];
      const vRow: (SpriteVariant | null)[] = [];
      const sprites = list?.[v]?.sprites as Record<string, unknown> | undefined;
      const blueOffset = asOffset2(sprites?.blue_led_light_offset, [-0.28, -0.48]);
      const rgOffset = asOffset2(sprites?.red_green_led_light_offset, [0.2, 0.16]);

      for (let f = 0; f < frameCount; f++) {
        if (!splitMain) {
          const info = await bank.addSprite(sheet, f, v);
          row.push(bank.toVariant(info));
          continue;
        }
        const crop = await cropSpriteFrame(sheet, f, v);
        const split = await splitBeltFrameMain(crop, {
          shift,
          scale,
          blueOffset,
          rgOffset,
        });
        const cleanId = await bank.add(split.clean);
        row.push(
          bank.toVariant({
            frameId: cleanId,
            scale,
            shift,
            shadow: false,
          }),
        );
        if (split.wireHorizontal) {
          const id = await bank.add(split.wireHorizontal);
          hRow.push(bank.toVariant({ frameId: id, scale, shift, shadow: false }));
        } else {
          hRow.push(null);
        }
        if (split.wireVertical) {
          const id = await bank.add(split.wireVertical);
          vRow.push(bank.toVariant({ frameId: id, scale, shift, shadow: false }));
        } else {
          vRow.push(null);
        }
      }
      grid.push(row);
      if (splitMain) {
        wireHGrid.push(hRow);
        wireVGrid.push(vRow);
      }
    }
    if (key === "frame_main") layers.frame_main = grid;
    else if (key === "frame_shadow") layers.frame_shadow = grid;
    else layers.frame_back_patch = grid.map((row) => row[0] ?? null);
    if (splitMain) {
      layers.wire_horizontal = wireHGrid;
      layers.wire_vertical = wireVGrid;
    }
  }

  // LED sprites: each circuit_connector[i] already bakes x/y for topology i.
  if (list?.length) {
    for (const key of BELT_CONNECTOR_LED_KEYS) {
      const variants: (SpriteVariant | null)[] = [];
      let any = false;
      for (let i = 0; i < list.length; i++) {
        const spr = (list[i]?.sprites as Record<string, RawSprite> | undefined)?.[key];
        if (!spr) {
          variants.push(null);
          continue;
        }
        const leaves = leafLayers(spr).filter((l) => !l.apply_runtime_tint && !l.draw_as_light);
        const leaf = leaves[0];
        if (!leaf) {
          variants.push(null);
          continue;
        }
        const info = await bank.addSprite(leaf, 0, 0);
        variants.push(bank.toVariant(info));
        any = true;
      }
      if (any) layers[key] = variants;
    }
  }

  if (Object.keys(layers).length === 0) return undefined;
  return { indexing: "belt-topology", layers };
}

export async function withBeltConnectorGraphics(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  if (def.kind !== "belt") return def;
  const graphics = await distillBeltConnectorGraphics(bank, p);
  if (!graphics) return def;
  return { ...def, data: { ...def.data, beltConnectorGraphics: graphics } };
}

export type BeltReaderLayerEntry = {
  sprites?: RawSprite;
  render_layer?: string;
};

/**
 * Distill belt_animation_set.belt_reader[] — side-skirt graphics for
 * entire_belt_hold (whole-line read).
 *
 * Engine sheet layout (from Factorio binary validation strings):
 * - rows (direction_count): StraightSolidBand, StraightOpenBand, CurvedSolidBand, Ending
 * - frames: North, East, South, West (tile-edge pieces, not belt facing)
 */
export async function distillBeltReaderGraphics(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<BeltReaderGraphics | undefined> {
  const bas = p.belt_animation_set as { belt_reader?: BeltReaderLayerEntry[] } | undefined;
  const readers = bas?.belt_reader;
  if (!Array.isArray(readers) || readers.length === 0) return undefined;

  const layers: {
    layer: RenderLayerName;
    /** [band][frame] = StraightSolid/Open/Curved/Ending × N/E/S/W */
    variants: (SpriteVariant | null)[][];
  }[] = [];

  for (const entry of readers) {
    const spr = entry.sprites;
    if (!spr) continue;
    const leaves = leafLayers(spr).filter((l) => !l.apply_runtime_tint && !l.draw_as_light);
    const leaf = leaves[0];
    if (!leaf) continue;
    const bandCount = leaf.direction_count ?? 4;
    const frameCount = leaf.frame_count ?? 4;
    const variants: (SpriteVariant | null)[][] = [];
    for (let band = 0; band < bandCount; band++) {
      const row: (SpriteVariant | null)[] = [];
      for (let frame = 0; frame < frameCount; frame++) {
        const info = await bank.addSprite(leaf, frame, band);
        const meta = bank.metas()[info.frameId];
        if (meta && meta.w <= 1 && meta.h <= 1) {
          row.push(null);
        } else {
          row.push(bank.toVariant(info));
        }
      }
      variants.push(row);
    }
    const layerName =
      officialLayer(entry.render_layer) ??
      guessedLayer("transport-belt-reader", "belt_reader layer missing render_layer");
    if (variants.every((row) => row.every((v) => v == null))) continue;
    layers.push({ layer: layerName, variants });
  }

  if (layers.length === 0) return undefined;
  return { indexing: "belt-reader-band-nesw", layers };
}

export async function withBeltReaderGraphics(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  // Belts and undergrounds share belt_animation_set.belt_reader (skirts run under UG hoods).
  if (def.kind !== "belt" && def.kind !== "underground-belt") return def;
  const graphics = await distillBeltReaderGraphics(bank, p);
  if (!graphics) return def;
  return { ...def, data: { ...def.data, beltReaderGraphics: graphics } };
}
/**
 * Wall pictures are asymmetric (Factorio only authors a subset). Map each NESW
 * mask to the closest authored variant; prefer single as fallback.
 */
