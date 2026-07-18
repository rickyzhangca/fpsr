import { fpsrLayer, guessedLayer } from "../../render-layers.js";
import { dirs4, isSprite4Way, leafLayers, type FrameBank } from "../../sprite.js";
import type {
  EntityRenderDef,
  LayerGroup,
  RawSprite,
  RenderLayerName,
  SpriteVariant,
} from "../../types.js";
import { colorFromProto } from "../shared/color.js";
import { baseEntity, layersFromSprite } from "../shared/layers.js";
import { withWireAnchors } from "../shared/wire.js";

export async function distillElectricPole(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as RawSprite;
  const graphics = await layersFromSprite(bank, pictures, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
  });
  return withWireAnchors(baseEntity("simple", "electric-pole", p, graphics), p);
}

export async function distillCombinatorSprites(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const sprites = p.sprites as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, sprites, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
  });
  const def = baseEntity("simple", protoType, p, graphics);
  const symbolFields: Record<string, string> =
    protoType === "arithmetic-combinator"
      ? {
          "+": "plus_symbol_sprites",
          "-": "minus_symbol_sprites",
          "*": "multiply_symbol_sprites",
          "/": "divide_symbol_sprites",
          "%": "modulo_symbol_sprites",
          "^": "power_symbol_sprites",
          "<<": "left_shift_symbol_sprites",
          ">>": "right_shift_symbol_sprites",
          AND: "and_symbol_sprites",
          OR: "or_symbol_sprites",
          XOR: "xor_symbol_sprites",
        }
      : protoType === "decider-combinator"
        ? {
            "=": "equal_symbol_sprites",
            ">": "greater_symbol_sprites",
            "<": "less_symbol_sprites",
            "≠": "not_equal_symbol_sprites",
            "≤": "less_or_equal_symbol_sprites",
            "≥": "greater_or_equal_symbol_sprites",
          }
        : protoType === "selector-combinator"
          ? {
              count: "count_symbol_sprites",
              random: "random_symbol_sprites",
              max: "max_symbol_sprites",
              min: "min_symbol_sprites",
              quality: "quality_symbol_sprites",
              "rocket-capacity": "rocket_capacity_sprites",
              "stack-size": "stack_size_sprites",
              time: "time_symbol_sprites",
            }
          : {};

  const symbols: Record<string, (SpriteVariant | null)[]> = {};
  for (const [key, field] of Object.entries(symbolFields)) {
    const sprite = p[field] as RawSprite | undefined;
    if (!sprite || !isSprite4Way(sprite)) continue;
    const variants: (SpriteVariant | null)[] = [];
    for (const direction of dirs4(sprite)) {
      const leaf = leafLayers(direction).find(
        (candidate) =>
          !candidate.draw_as_shadow && !candidate.apply_runtime_tint && !candidate.draw_as_light,
      );
      if (!leaf) {
        variants.push(null);
        continue;
      }
      const info = await bank.addSprite(leaf, 0, 0);
      variants.push(bank.toVariant(info));
    }
    if (variants.some(Boolean)) symbols[key] = variants;
  }

  return Object.keys(symbols).length > 0
    ? { ...def, data: { ...def.data, combinatorGraphics: { symbols } } }
    : def;
}

export async function distillPowerSwitch(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const anim = p.power_on_animation as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, anim, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
    frame: 0,
  });
  return baseEntity("simple", "power-switch", p, graphics);
}

export async function distillRoboport(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  // Base body paints an opaque black bay recess; covers below fill it for idle/blueprint view.
  groups.push(
    ...(await layersFromSprite(bank, p.base as RawSprite | undefined, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
    })),
  );
  // Hangar floor under the doors (visible around the closed shutter / when doors open).
  groups.push(
    ...(await layersFromSprite(bank, p.base_patch as RawSprite | undefined, {
      layer: guessedLayer("object", "roboport base_patch"),
      indexing: "single",
    })),
  );
  // Frame 0 = closed iris shutter (door_animation_* sheets open across later frames).
  groups.push(
    ...(await layersFromSprite(bank, p.door_animation_down as RawSprite | undefined, {
      layer: guessedLayer("object", "roboport door_animation_down closed"),
      indexing: "single",
      frame: 0,
    })),
  );
  groups.push(
    ...(await layersFromSprite(bank, p.door_animation_up as RawSprite | undefined, {
      layer: guessedLayer("object", "roboport door_animation_up closed"),
      indexing: "single",
      frame: 0,
    })),
  );
  // Idle antenna / dish still-frame (top-left of the unit).
  groups.push(
    ...(await layersFromSprite(bank, p.base_animation as RawSprite | undefined, {
      layer: guessedLayer("object", "roboport base_animation idle"),
      indexing: "single",
      frame: 0,
    })),
  );
  return baseEntity("simple", "roboport", p, groups);
}

export async function distillTrainStop(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  let colorMaskGroupIndex: number | undefined;

  // Ground pad under the rail (FBSR: RAIL_SCREW).
  groups.push(
    ...(await layersFromSprite(bank, p.rail_overlay_animations as RawSprite | undefined, {
      layer: guessedLayer("rail-screw", "train-stop rail_overlay_animations"),
      indexing: "direction4",
      frame: 0,
    })),
  );

  // Bottom post + shadow (object / shadow). Trains on `object` may cover this —
  // the top flag below is what must stay visible.
  groups.push(
    ...(await layersFromSprite(bank, p.animations as RawSprite | undefined, {
      layer: guessedLayer("object", "train-stop animations (bottom)"),
      indexing: "direction4",
      frame: 0,
    })),
  );

  // Top board + tint mask on `train-stop-top` (above rolling stock `object`).
  const top = p.top_animations as RawSprite | undefined;
  if (top && isSprite4Way(top)) {
    const dirs = dirs4(top);
    const byLeaf = new Map<string, { group: LayerGroup; isMask: boolean }>();
    for (let di = 0; di < 4; di++) {
      const leaves = leafLayers(dirs[di]).filter((l) => !l.draw_as_light);
      let leafIdx = 0;
      for (const leaf of leaves) {
        const info = await bank.addSprite(leaf, 0, 0);
        const isMask = leaf.apply_runtime_tint === true;
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("train-stop-top", "train-stop top_animations above trains");
        const key = `${layerName}:${isMask ? "m" : info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let entry = byLeaf.get(key);
        if (!entry) {
          entry = {
            isMask,
            group: {
              layer: layerName,
              indexing: "direction4",
              variants: { default: [null, null, null, null] },
            },
          };
          byLeaf.set(key, entry);
        }
        const arr = entry.group.variants.default;
        if (!arr) continue;
        arr[di] = bank.toVariant(info);
      }
    }
    for (const { group, isMask } of byLeaf.values()) {
      if (isMask) colorMaskGroupIndex = groups.length;
      groups.push(group);
    }
  }

  const defaultColor = colorFromProto(p);
  return {
    ...baseEntity("simple", "train-stop", p, groups),
    data: {
      ...(colorMaskGroupIndex != null ? { colorMaskGroupIndex } : {}),
      ...(defaultColor ? { defaultColor } : {}),
    },
  };
}
