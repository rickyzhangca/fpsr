import { leafLayers, type FrameBank } from "../../sprite.js";
import { fpsrLayer, guessedLayer } from "../../render-layers.js";
import type { EntityRenderDef, LayerGroup, RawSprite, SpriteVariant } from "../../types.js";
import { baseEntity, distillSimplePicture, layersFromSprite } from "../shared/layers.js";
import { PIPE_MASK_KEYS, PIPE_WINDOW_BACKGROUND_KEYS, withFluidData } from "../shared/pipe.js";

export async function distillPipe(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, RawSprite>;
  const backgroundVariants: Record<string, (SpriteVariant | null)[]> = {};
  const objectVariants: Record<string, (SpriteVariant | null)[]> = {};

  for (const [mask, key] of Object.entries(PIPE_MASK_KEYS)) {
    const backgroundKey = PIPE_WINDOW_BACKGROUND_KEYS[mask];
    const background = backgroundKey ? pictures[backgroundKey] : undefined;
    if (backgroundKey && !background) throw new Error(`pipe missing picture ${backgroundKey}`);
    const backgroundLeaf = background
      ? leafLayers(background).find((leaf) => !leaf.draw_as_shadow)
      : undefined;
    backgroundVariants[mask] = backgroundLeaf
      ? [bank.toVariant(await bank.addSprite(backgroundLeaf, 0, 0))]
      : [null];

    const spr = pictures[key];
    if (!spr) throw new Error(`pipe missing picture ${key}`);
    const leaves = leafLayers(spr);
    const variants: SpriteVariant[] = [];
    for (const leaf of leaves) {
      if (leaf.draw_as_shadow) continue;
      const info = await bank.addSprite(leaf, 0, 0);
      variants.push(bank.toVariant(info));
    }
    const first = variants[0];
    objectVariants[mask] = first ? [first] : [null];
  }

  return withFluidData(
    baseEntity("pipe", "pipe", p, [
      {
        layer: guessedLayer("object-under", "pipe window background below pipe body"),
        indexing: "single",
        variants: backgroundVariants,
      },
      {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        variants: objectVariants,
      },
    ]),
    p,
  );
}

export async function distillStorageTank(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as { picture?: RawSprite } | undefined;
  const pic = pictures?.picture;
  // Storage tank uses a SpriteNWaySheet with `frames: 2` (N/S vs E/W) — treat
  // as direction4 by sampling sheet cells 0 and 1 (see spriteFrameCount).
  if (pic) {
    const leaves = leafLayers(pic);
    const groups: LayerGroup[] = [];
    for (const leaf of leaves) {
      if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
      // Ensure `frames` is visible as frame_count for cropSpriteFrame.
      const sheet: RawSprite = {
        ...leaf,
        frame_count: leaf.frame_count ?? (typeof leaf.frames === "number" ? leaf.frames : 2),
      };
      const info0 = await bank.addSprite(sheet, 0, 0);
      const info1 = await bank.addSprite(sheet, 1, 0);
      const v0 = bank.toVariant(info0);
      const v1 = bank.toVariant(info1);
      // direction4: N=0, E=1, S=2, W=3 → frames 0,1,0,1
      groups.push({
        layer: info0.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump"),
        indexing: "direction4",
        variants: { default: [v0, v1, v0, v1] },
      });
    }
    return withFluidData(baseEntity("simple", "storage-tank", p, groups), p);
  }
  return withFluidData(await distillSimplePicture(bank, p, "storage-tank"), p);
}

export async function distillPump(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const anims = p.animations as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, anims, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
    frame: 0,
  });
  return withFluidData(baseEntity("simple", "pump", p, graphics), p);
}
