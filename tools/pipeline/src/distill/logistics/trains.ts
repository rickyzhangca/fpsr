import { leafLayers, round4, type FrameBank } from "../../sprite.js";
import { fpsrLayer, guessedLayer } from "../../render-layers.js";
import type {
  EntityRenderDef,
  LayerGroup,
  RawSprite,
  RenderLayerName,
  SpriteVariant,
} from "../../types.js";
import { colorFromProto } from "../shared/color.js";
import { baseEntity } from "../shared/layers.js";

export const TRAIN_MAX_POSES = 64;

export function trainPoseDirs(dirCount: number): number[] {
  const step = Math.max(1, Math.ceil(dirCount / TRAIN_MAX_POSES));
  const poses: number[] = [];
  for (let d = 0; d < dirCount; d += step) poses.push(d);
  return poses;
}

export async function distillTrainRotatedLeaf(
  bank: FrameBank,
  leaf: RawSprite,
  layerName: RenderLayerName,
): Promise<{ group: LayerGroup; poseCount: number }> {
  const dirCount = leaf.direction_count ?? 1;
  const poses = trainPoseDirs(dirCount);
  const info0 = await bank.addSprite(leaf, 0, poses[0] ?? 0);
  const variants: (SpriteVariant | null)[] = [];
  for (let i = 0; i < poses.length; i++) {
    const d = poses[i] ?? 0;
    const info = i === 0 ? info0 : await bank.addSprite(leaf, 0, d);
    variants.push(bank.toVariant(info));
  }
  return {
    poseCount: poses.length,
    group: {
      layer: layerName,
      indexing: "resolver",
      variants: { default: variants },
    },
  };
}

export async function distillTrain(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  let orientationCount = TRAIN_MAX_POSES;
  let colorMaskGroupIndex: number | undefined;

  const wheels = (p.wheels as { rotated?: RawSprite } | undefined)?.rotated;
  let wheelsGroupIndex: number | undefined;
  if (wheels) {
    wheelsGroupIndex = groups.length;
    for (const leaf of leafLayers(wheels).filter((l) => !l.draw_as_light)) {
      const { group, poseCount } = await distillTrainRotatedLeaf(
        bank,
        leaf,
        // Same layer as body (FBSR HIGHER_OBJECT_UNDER): wheels first via
        // group sub-index, then body; neighbor wagons' wheels can paint over
        // the previous body's end so coupler hooks stay visible in the gap.
        guessedLayer("object", "train wheels; same layer as body (FBSR)"),
      );
      orientationCount = Math.min(orientationCount, poseCount);
      groups.push(group);
    }
  }

  const pictures = p.pictures as { rotated?: RawSprite } | undefined;
  const rotated = pictures?.rotated;
  let backEqualsFront = false;
  if (rotated) {
    for (const leaf of leafLayers(rotated).filter((l) => !l.draw_as_light)) {
      if (leaf.back_equals_front === true) backEqualsFront = true;
      const isMask = leaf.apply_runtime_tint === true;
      const layerName: RenderLayerName = leaf.draw_as_shadow
        ? fpsrLayer("shadow", "draw_as_shadow leaf")
        : guessedLayer("object", "train body/mask; not in dump");
      const { group, poseCount } = await distillTrainRotatedLeaf(bank, leaf, layerName);
      orientationCount = Math.min(orientationCount, poseCount);
      if (isMask) colorMaskGroupIndex = groups.length;
      groups.push(group);
    }
  }

  // Artillery wagon: cannon barrel then base (FBSR paint order). Same orientation
  // indexing as the rolling-stock body; resolve applies cannonBaseShift.
  const cannonGroupIndices: number[] = [];
  for (const key of ["cannon_barrel_pictures", "cannon_base_pictures"] as const) {
    const rotatedCannon = (p[key] as { rotated?: RawSprite } | undefined)?.rotated;
    if (!rotatedCannon) continue;
    for (const leaf of leafLayers(rotatedCannon).filter((l) => !l.draw_as_light)) {
      const layerName: RenderLayerName = leaf.draw_as_shadow
        ? fpsrLayer("shadow", "artillery cannon shadow")
        : guessedLayer("object", "artillery cannon; RollingStock cannon_*_pictures");
      const { group, poseCount } = await distillTrainRotatedLeaf(bank, leaf, layerName);
      orientationCount = Math.min(orientationCount, poseCount);
      cannonGroupIndices.push(groups.length);
      groups.push(group);
    }
  }

  const defaultColor = colorFromProto(p);
  const jointDistance =
    typeof p.joint_distance === "number" && Number.isFinite(p.joint_distance)
      ? round4(p.joint_distance)
      : undefined;
  const connectionDistance =
    typeof p.connection_distance === "number" && Number.isFinite(p.connection_distance)
      ? round4(p.connection_distance)
      : undefined;
  const cannonBaseHeight =
    typeof p.cannon_base_height === "number" && Number.isFinite(p.cannon_base_height)
      ? round4(p.cannon_base_height)
      : undefined;
  const cannonBaseShiftWhenVertical =
    typeof p.cannon_base_shift_when_vertical === "number" &&
    Number.isFinite(p.cannon_base_shift_when_vertical)
      ? round4(p.cannon_base_shift_when_vertical)
      : undefined;
  const cannonBaseShiftWhenHorizontal =
    typeof p.cannon_base_shift_when_horizontal === "number" &&
    Number.isFinite(p.cannon_base_shift_when_horizontal)
      ? round4(p.cannon_base_shift_when_horizontal)
      : undefined;
  return {
    ...baseEntity("train", protoType, p, groups),
    data: {
      orientationCount,
      ...(wheelsGroupIndex != null ? { wheelsGroupIndex } : {}),
      ...(jointDistance != null ? { jointDistance } : {}),
      ...(connectionDistance != null ? { connectionDistance } : {}),
      ...(colorMaskGroupIndex != null ? { colorMaskGroupIndex } : {}),
      ...(defaultColor ? { defaultColor } : {}),
      ...(backEqualsFront ? { backEqualsFront: true } : {}),
      ...(cannonGroupIndices.length > 0 ? { cannonGroupIndices } : {}),
      ...(cannonBaseHeight != null ? { cannonBaseHeight } : {}),
      ...(cannonBaseShiftWhenVertical != null ? { cannonBaseShiftWhenVertical } : {}),
      ...(cannonBaseShiftWhenHorizontal != null ? { cannonBaseShiftWhenHorizontal } : {}),
    },
  };
}

/** Semi-transparent gray footprint sprite sized to the selection box. */
