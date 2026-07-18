import { fpsrLayer, guessedLayer } from "../render-layers.js";
import { leafLayers, type FrameBank } from "../sprite.js";
import type {
  EntityRenderDef,
  LayerGroup,
  RawSprite,
  RenderLayerName,
  SpriteVariant,
} from "../types.js";
import { colorFromProto } from "./shared/color.js";
import { baseEntity, layersFromSprite } from "./shared/layers.js";

/**
 * NESW bitmask → WallPictures key. Factorio only authors south-extending pieces;
 * north links are drawn by the northern neighbour, so N-only / N+E / N+W collapse
 * onto single / ending_* / straight_horizontal (same as the runtime wallMask).
 */
export const WALL_MASK_KEYS: Record<string, string> = {
  "0000": "single",
  "1000": "single",
  "0100": "ending_right",
  "0010": "straight_vertical",
  "0001": "ending_left",
  "1100": "ending_right",
  "1010": "straight_vertical",
  "1001": "ending_left",
  "0110": "corner_right_down",
  "0101": "straight_horizontal",
  "0011": "corner_left_down",
  "1110": "corner_right_down",
  "1101": "straight_horizontal",
  "1011": "corner_left_down",
  "0111": "t_up",
  "1111": "t_up",
};

/**
 * Belt animation_set row order (0-based), matching Factorio's commented
 * east_index=1..ending_east_index=20 (1-based) in transport-belts.lua:
 *  0 east, 1 west, 2 north, 3 south,
 *  4 east_to_north, 5 north_to_east, 6 west_to_north, 7 north_to_west,
 *  8 south_to_east, 9 east_to_south, 10 south_to_west, 11 west_to_south,
 *  12 starting_south, 13 ending_south, 14 starting_west, 15 ending_west,
 *  16 starting_north, 17 ending_north, 18 starting_east, 19 ending_east
 */

export async function distillWall(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, RawSprite>;
  const objectVariants: Record<string, (SpriteVariant | null)[]> = {};

  for (const [mask, key] of Object.entries(WALL_MASK_KEYS)) {
    const spr = pictures[key] ?? pictures.single;
    const leaves = leafLayers(spr).filter((l) => !l.draw_as_shadow);
    const leaf = leaves[0];
    if (!leaf) {
      objectVariants[mask] = [null];
      continue;
    }
    const info = await bank.addSprite(leaf, 0, 0);
    objectVariants[mask] = [bank.toVariant(info)];
  }

  return baseEntity("wall", "wall", p, [
    {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      variants: objectVariants,
    },
  ]);
}

export async function distillGate(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const vertical = p.vertical_animation as RawSprite;
  const horizontal = p.horizontal_animation as RawSprite;
  const groups: LayerGroup[] = [];

  for (const [key, spr] of [
    ["vertical", vertical],
    ["horizontal", horizontal],
  ] as const) {
    const parts = await layersFromSprite(bank, spr, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      variantKey: key,
      frame: 0,
    });
    for (const part of parts) {
      const existing = groups.find((g) => g.layer === part.layer && g.indexing === part.indexing);
      if (existing) Object.assign(existing.variants, part.variants);
      else groups.push(part);
    }
  }

  return baseEntity("gate", "gate", p, groups);
}

export async function distillRadar(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  // Use direction index 0 only (single pose) for M1 — radar has 64 directions.
  const pictures = p.pictures as RawSprite;
  const forced: LayerGroup[] = [];
  for (const leaf of leafLayers(pictures)) {
    if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
    const info = await bank.addSprite(leaf, 0, 0);
    forced.push({
      layer: info.shadow
        ? fpsrLayer("shadow", "draw_as_shadow leaf")
        : guessedLayer("object", "entity body; not in dump"),
      indexing: "single",
      variants: { default: [bank.toVariant(info)] },
    });
  }
  return baseEntity("simple", "radar", p, forced);
}

export async function distillVehicleRotatedLeaf(
  bank: FrameBank,
  leaf: RawSprite,
  layerName: RenderLayerName,
  frame: number,
): Promise<{ group: LayerGroup; poseCount: number }> {
  const poseCount = Math.max(1, leaf.direction_count ?? 1);
  const variants: (SpriteVariant | null)[] = [];
  for (let direction = 0; direction < poseCount; direction++) {
    const info = await bank.addSprite(leaf, frame, direction);
    variants.push(bank.toVariant(info));
  }
  return {
    poseCount,
    group: {
      layer: layerName,
      indexing: "resolver",
      variants: { default: variants },
    },
  };
}

/**
 * Cars and tanks author their body, tint masks, shadows, and turret as direct
 * 64-way RotatedAnimation poses. Unlike trains these poses use blueprint
 * orientation through the renderer's vehicle-sheet projection, without
 * Factorio's rolling-stock-only rail and bogie offsets.
 */
export async function distillVehicle(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  const colorMaskGroupIndices: number[] = [];
  let orientationCount: number | undefined;

  for (const sprite of [
    p.animation as RawSprite | undefined,
    p.turret_animation as RawSprite | undefined,
  ]) {
    for (const leaf of leafLayers(sprite).filter((candidate) => !candidate.draw_as_light)) {
      const layerName: RenderLayerName = leaf.draw_as_shadow
        ? fpsrLayer("shadow", "vehicle draw_as_shadow leaf")
        : guessedLayer("object", "vehicle body, mask, or turret");
      const frame = Math.min(leaf.still_frame ?? 0, Math.max(0, (leaf.frame_count ?? 1) - 1));
      const { group, poseCount } = await distillVehicleRotatedLeaf(bank, leaf, layerName, frame);
      orientationCount = Math.min(orientationCount ?? poseCount, poseCount);
      if (leaf.apply_runtime_tint === true) colorMaskGroupIndices.push(groups.length);
      groups.push(group);
    }
  }

  const hasColorMask = colorMaskGroupIndices.length > 0;
  const defaultColor = colorFromProto(p);
  return {
    ...baseEntity("vehicle", protoType, p, groups),
    data: {
      orientationCount: orientationCount ?? 1,
      ...(hasColorMask ? { colorMaskGroupIndices } : {}),
      ...(defaultColor ? { defaultColor } : {}),
    },
  };
}

export async function distillTurret(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  const gs = p.graphics_set as { base_visualisation?: { animation?: RawSprite } } | undefined;
  if (gs?.base_visualisation?.animation) {
    groups.push(
      ...(await layersFromSprite(bank, gs.base_visualisation.animation, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        frame: 0,
      })),
    );
  }
  if (p.base_picture) {
    groups.push(
      ...(await layersFromSprite(bank, p.base_picture as RawSprite, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        frame: 0,
      })),
    );
  }
  const folded = (p.folded_animation ?? p.cannon_base_pictures) as RawSprite | undefined;
  if (folded) {
    groups.push(
      ...(await layersFromSprite(bank, folded, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "direction4",
        frame: 0,
        assumeDirectionCount: 4,
      })),
    );
  }
  return baseEntity("simple", protoType, p, groups);
}
