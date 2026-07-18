import { round4, spriteSize, type FrameBank } from "../../sprite.js";
import { guessedLayer } from "../../render-layers.js";
import type { EntityRenderDef, LayerGroup, RawSprite, SpriteVariant } from "../../types.js";
import { baseEntity, layersFromSprite } from "../shared/layers.js";

export type InserterHandPose = { rot: number; squish: number; x: number; y: number };

/** Regular inserter: [N,E,S,W] for hand_open then hand_base. */
export const INSERTER_HAND_POSES: { hand: InserterHandPose; arm: InserterHandPose }[] = [
  // N
  {
    hand: { rot: 0, squish: 3, x: 0, y: -0.5 },
    arm: { rot: 0, squish: 1.4, x: 0, y: 0.05 },
  },
  // E
  {
    hand: { rot: 135, squish: 2.5, x: 0.325, y: -0.325 },
    arm: { rot: 45, squish: 1.9, x: -0.03, y: 0.03 },
  },
  // S
  {
    hand: { rot: 180, squish: 1.75, x: 0, y: 0.03 },
    arm: { rot: 180, squish: 7, x: 0, y: -0.03 },
  },
  // W
  {
    hand: { rot: -135, squish: 2.5, x: -0.325, y: -0.325 },
    arm: { rot: -45, squish: 1.9, x: 0.03, y: 0.03 },
  },
];

/** Long-handed inserter poses (FBE). */
export const LHI_HAND_POSES: { hand: InserterHandPose; arm: InserterHandPose }[] = [
  {
    hand: { rot: 180, squish: 3.5, x: 0, y: -0.95 },
    arm: { rot: 0, squish: 1, x: 0, y: 0.05 },
  },
  {
    hand: { rot: 155, squish: 1.5, x: 0.275, y: -0.7 },
    arm: { rot: 25, squish: 1.25, x: -0.03, y: 0.03 },
  },
  {
    hand: { rot: 180, squish: 1.25, x: 0, y: -0.3 },
    arm: { rot: 0, squish: 2.5, x: 0, y: 0.03 },
  },
  {
    hand: { rot: -155, squish: 1.5, x: -0.275, y: -0.7 },
    arm: { rot: -25, squish: 1.25, x: 0.03, y: 0.03 },
  },
];

/**
 * Bottom-center pivot at (pose.x, pose.y): place sprite center by rotating the
 * local (0, -hEff/2) offset with canvas-clockwise degrees.
 */
export function inserterHandShift(pose: InserterHandPose, hTiles: number): [number, number] {
  const hEff = hTiles / pose.squish;
  const localDy = -hEff / 2;
  const rad = (pose.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Canvas CW with y-down: (x,y) → (x cos − y sin, x sin + y cos)
  return [round4(pose.x - localDy * sin), round4(pose.y + localDy * cos)];
}

export async function distillInserter(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  /**
   * Inserter pose (FBE-compatible):
   * - Layer 0: platform_picture as direction4 (horizontal columns).
   *   Runtime selects the opposite column ((dir+8)%16)/4 — platform art faces drop.
   * - Layers 1–2: hand_base + hand_open with bottom-center pivot, per-dir
   *   rotation/squish/offset so the arm reads as a bent pickup pose.
   * GUESS: dump has no render_layer on inserters; engine hardcodes.
   * Split layers (in-game look): platform under the belt sheet; hands above belts
   * and above assembling-machine bodies so arms aren't buried in the machine.
   */
  const platform = p.platform_picture as RawSprite;
  const platformGroups = await layersFromSprite(bank, platform, {
    layer: guessedLayer("floor", "inserter platform under belts; not in dump"),
    indexing: "direction4",
    assumeDirectionCount: 4,
    sampleDirectionsAsColumns: true,
  });

  const poses =
    (p.name as string | undefined) === "long-handed-inserter"
      ? LHI_HAND_POSES
      : INSERTER_HAND_POSES;

  const handParts: {
    sprite: RawSprite | undefined;
    poseKey: "arm" | "hand";
  }[] = [
    { sprite: p.hand_base_picture as RawSprite | undefined, poseKey: "arm" },
    { sprite: p.hand_open_picture as RawSprite | undefined, poseKey: "hand" },
  ];

  const handGroups: LayerGroup[] = [];
  for (const part of handParts) {
    if (!part.sprite) continue;
    const handInfo = await bank.addSprite(part.sprite, 0, 0);
    const [, shPx] = spriteSize(part.sprite);
    const hTiles = (handInfo.scale * shPx) / 32;
    const handVariants: (SpriteVariant | null)[] = poses.map((dirPose) => {
      const pose = dirPose[part.poseKey];
      return bank.toVariant(handInfo, inserterHandShift(pose, hTiles), {
        rotation: pose.rot,
        scaleY: 1 / pose.squish,
      });
    });
    handGroups.push({
      layer: guessedLayer(
        "higher-object-under",
        "inserter hand above belts and object bodies; not in dump",
      ),
      indexing: "direction4",
      variants: { default: handVariants },
    });
  }

  return baseEntity("inserter", "inserter", p, [...platformGroups, ...handGroups]);
}
/**
 * Skip leaves that Factorio composites additively / as lights. Their source
 * sheets are mostly opaque black with a few bright pixels; drawing them as
 * normal sprites produces solid black rectangles (cargo-hub emissions, etc.).
 */
