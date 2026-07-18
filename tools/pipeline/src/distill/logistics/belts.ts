import { dirs4, isSprite4Way, type FrameBank } from "../../sprite.js";
import { guessedLayer, officialLayer } from "../../render-layers.js";
import type { EntityRenderDef, LayerGroup, RawSprite, SpriteVariant } from "../../types.js";
import { baseEntity, layersFromSprite } from "../shared/layers.js";

export const BELT_ROW_ORDER = [
  "east",
  "west",
  "north",
  "south",
  "east_to_north",
  "north_to_east",
  "west_to_north",
  "north_to_west",
  "south_to_east",
  "east_to_south",
  "south_to_west",
  "west_to_south",
  "starting_south",
  "ending_south",
  "starting_west",
  "ending_west",
  "starting_north",
  "ending_north",
  "starting_east",
  "ending_east",
] as const;

/** Per-direction hand pose (FBE spriteDataBuilder.draw_inserter). */

export async function distillBelt(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const bas = p.belt_animation_set as { animation_set: RawSprite };
  const sheet = bas.animation_set;
  const dirCount = sheet.direction_count ?? 20;
  const variants: (SpriteVariant | null)[] = [];
  for (let d = 0; d < dirCount; d++) {
    const info = await bank.addSprite(sheet, 0, d);
    variants.push(bank.toVariant(info));
  }
  return baseEntity("belt", protoType, p, [
    {
      // GUESS: main belt sheet has no render_layer; belt_reader[] is distilled separately.
      layer: guessedLayer("transport-belt", "belt animation_set body; not in dump"),
      indexing: "resolver",
      variants: { default: variants },
    },
  ]);
}

/**
 * Belt underlay for UG/loader/splitter: direction4 straights plus start/end cap
 * rows (N,E,S,W). Sheet rows: east=0, west=1, north=2, south=3; starts 12/14/16/18;
 * ends 17/19/13/15 (same mapping as BELT_START_INDEX / BELT_END_INDEX).
 */
export async function distillBeltUnderlayGroup(
  bank: FrameBank,
  sheet: RawSprite,
): Promise<LayerGroup> {
  const straightRows = [2, 0, 3, 1];
  const startRows = [12, 14, 16, 18];
  const endRows = [17, 19, 13, 15];
  const sample = async (rows: number[]): Promise<(SpriteVariant | null)[]> => {
    const out: (SpriteVariant | null)[] = [];
    for (const row of rows) {
      const info = await bank.addSprite(sheet, 0, row);
      out.push(bank.toVariant(info));
    }
    return out;
  };
  return {
    // GUESS: underlay uses same band as belt body; dump only labels belt_reader overlays.
    layer: guessedLayer("transport-belt", "belt underlay sheet; not in dump"),
    indexing: "direction4",
    variants: {
      default: await sample(straightRows),
      start: await sample(startRows),
      end: await sample(endRows),
    },
  };
}

export async function distillUndergroundBelt(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const structure = p.structure as {
    direction_in: RawSprite;
    direction_out: RawSprite;
    back_patch?: RawSprite;
    front_patch?: RawSprite;
  };
  const groups: LayerGroup[] = [];

  // OFFICIAL when loader sets structure_render_layer; else GUESS object (UG has none).
  const structureLayer =
    officialLayer(p.structure_render_layer) ??
    guessedLayer("object", "UG/loader hood; dump has no structure_render_layer");

  // Back patch sits between belt and hood (FBE paint order).
  if (structure.back_patch) {
    const back = await layersFromSprite(bank, structure.back_patch, {
      layer: guessedLayer("object-under", "UG back_patch; FBE order, not in dump"),
      indexing: "direction4",
      assumeDirectionCount: 4,
      sampleDirectionsAsColumns: true,
    });
    groups.push(...back);
  }

  for (const [key, spr] of [
    ["in", structure.direction_in],
    ["out", structure.direction_out],
  ] as const) {
    const g = await layersFromSprite(bank, spr, {
      layer: structureLayer,
      indexing: "direction4",
      variantKey: key,
      assumeDirectionCount: 4,
      sampleDirectionsAsColumns: true,
    });
    // Merge into one group per layer with both variant keys
    for (const part of g) {
      const existing = groups.find((x) => x.layer === part.layer && x.indexing === part.indexing);
      if (existing) {
        Object.assign(existing.variants, part.variants);
      } else {
        groups.push(part);
      }
    }
  }

  // Front patch completes the hood lip; own group so it paints after the main structure.
  if (structure.front_patch) {
    const front = await layersFromSprite(bank, structure.front_patch, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "direction4",
      assumeDirectionCount: 4,
      sampleDirectionsAsColumns: true,
    });
    groups.push(...front);
  }

  // Also include belt animation underneath (straights + start/end caps).
  const bas = p.belt_animation_set as { animation_set: RawSprite } | undefined;
  if (bas?.animation_set) {
    const underlay = await distillBeltUnderlayGroup(bank, bas.animation_set);
    groups.unshift(underlay);
  }

  return baseEntity("underground-belt", protoType, p, groups);
}

export async function distillSplitter(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const structure = p.structure as RawSprite;
  const structureGraphics = await layersFromSprite(bank, structure, {
    layer: guessedLayer("object", "splitter structure; not in dump"),
    indexing: "direction4",
    frame: 0,
  });
  const graphics: LayerGroup[] = [];

  const patch = p.structure_patch as RawSprite | undefined;
  if (patch && isSprite4Way(patch)) {
    const patchGroup: LayerGroup = {
      layer: guessedLayer("object-under", "splitter structure_patch; FBE order, not in dump"),
      indexing: "direction4",
      variants: { default: [null, null, null, null] },
    };
    const dirs = dirs4(patch);
    for (let di = 0; di < 4; di++) {
      const leaf = dirs[di];
      if (!leaf || leaf.filename?.includes("empty.png")) continue;
      const info = await bank.addSprite(leaf, 0, 0);
      patchGroup.variants.default![di] = bank.toVariant(info);
    }
    graphics.push(patchGroup);
  }
  graphics.push(...structureGraphics);

  // Belt underlay (straights + start/end caps for continuous lane ends)
  const bas = p.belt_animation_set as { animation_set: RawSprite } | undefined;
  if (bas?.animation_set) {
    graphics.unshift(await distillBeltUnderlayGroup(bank, bas.animation_set));
  }
  return {
    ...baseEntity("splitter", protoType, p, graphics),
    data: { tileSize: [2, 1] },
  };
}

export async function distillLoader(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  // Same structure shape as underground-belt (direction_in / direction_out).
  return {
    ...(await distillUndergroundBelt(bank, p, protoType)),
    kind: "loader",
    protoType,
  };
}

export async function distillLinkedBelt(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  return distillLoader(bank, p, "linked-belt");
}
