import { leafLayers, spriteSize, type FrameBank } from "../../sprite.js";
import {
  fpsrLayer,
  guessedLayer,
  officialLayer,
  railPieceLayerFromDump,
} from "../../render-layers.js";
import type {
  EntityRenderDef,
  LayerGroup,
  RawSprite,
  RenderLayerName,
  SpriteVariant,
} from "../../types.js";
import { baseEntity, layersFromSprite, skipIdleDecorativeLeaf } from "../shared/layers.js";
import { withWireAnchors } from "../shared/wire.js";

export const RAIL_DIR8_KEYS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

/**
 * Resolve rail piece layer from dump `pictures.render_layers` (OFFICIAL).
 * Sheet piece names (ties/backplates/…) map to dump keys (tie/screw/…).
 * TODO(M3): rail endings, segment visualisations, variation_count>0.
 */
export function railPieceLayer(
  pictures: Record<string, unknown> | undefined,
  piece: string,
  elevated: boolean,
): RenderLayerName {
  return railPieceLayerFromDump(pictures, piece, elevated).layer;
}

export interface RailPieceSample {
  visible: SpriteVariant[];
  shadows: SpriteVariant[];
}

export async function sampleRailPiece(
  bank: FrameBank,
  spr: RawSprite | undefined,
): Promise<RailPieceSample> {
  const sample: RailPieceSample = { visible: [], shadows: [] };
  for (const leaf of leafLayers(spr)) {
    if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
    // Skip empty / unused direction stubs (1×1 placeholders).
    try {
      const [w, h] = spriteSize(leaf);
      if (w <= 1 && h <= 1) continue;
    } catch {
      continue;
    }
    const info = await bank.addSprite(leaf, 0, 0);
    (info.shadow ? sample.shadows : sample.visible).push(bank.toVariant(info));
  }
  return sample;
}

export function appendRailPieceGroups(
  groups: LayerGroup[],
  samples: RailPieceSample[],
  indexing: LayerGroup["indexing"],
  visibleLayer: RenderLayerName,
): void {
  for (const kind of ["visible", "shadows"] as const) {
    const count = Math.max(0, ...samples.map((sample) => sample[kind].length));
    for (let leaf = 0; leaf < count; leaf++) {
      const variants = samples.map((sample) => sample[kind][leaf] ?? null);
      // Straight and half-diagonal rails only author the first half-turn.
      if (samples.length === 8) {
        for (let direction = 0; direction < 4; direction++) {
          if (!variants[direction + 4] && variants[direction]) {
            variants[direction + 4] = variants[direction] ?? null;
          }
        }
      }
      if (variants.every((variant) => variant == null)) continue;
      groups.push({
        layer:
          kind === "shadows" ? fpsrLayer("shadow", "draw_as_shadow rail-piece leaf") : visibleLayer,
        indexing,
        variants: { default: variants },
      });
    }
  }
}

export type RailFenceDirectionSet = Record<string, RawSprite | undefined>;

export interface RailFencePictureSet {
  fence?: RailFenceDirectionSet;
  fence_upper?: RailFenceDirectionSet;
}

export interface RailFenceGraphicsSet {
  side_A?: RailFencePictureSet;
  side_B?: RailFencePictureSet;
  back_fence_render_layer?: string;
  front_fence_render_layer?: string;
  back_fence_render_layer_secondary?: string;
  front_fence_render_layer_secondary?: string;
}

export interface RailFenceSample {
  visible: SpriteVariant[];
  shadows: SpriteVariant[];
  centerY: number | null;
}

export function alphaCenterY(
  bank: FrameBank,
  info: Awaited<ReturnType<FrameBank["addSprite"]>>,
): number {
  const frame = bank.list()[info.frameId];
  const meta = frame?.meta;
  const rgba = frame?.rgba;
  if (!meta || !rgba) return info.shift[1];

  let alphaSum = 0;
  let weightedY = 0;
  for (let y = 0; y < meta.h; y++) {
    for (let x = 0; x < meta.w; x++) {
      const alpha = rgba[(y * meta.w + x) * 4 + 3] ?? 0;
      alphaSum += alpha;
      weightedY += alpha * (meta.oy + y + 0.5);
    }
  }
  if (alphaSum === 0) return info.shift[1];
  const sourceY = weightedY / alphaSum - meta.sh / 2;
  return info.shift[1] + (sourceY * info.scale) / 32;
}

export async function sampleRailFence(
  bank: FrameBank,
  spr: RawSprite | undefined,
): Promise<RailFenceSample> {
  const visible: SpriteVariant[] = [];
  const shadows: SpriteVariant[] = [];
  const centers: number[] = [];
  for (const leaf of leafLayers(spr)) {
    if (skipIdleDecorativeLeaf(leaf)) continue;
    // For segmented rail fences, Factorio uses SpriteVariations as adjacent
    // pieces of one guard rail (curves and half-diagonals have two). They are
    // semantic slices, not interchangeable random artwork, so draw all of them.
    const variationCount = leaf.variation_count ?? 1;
    for (let variation = 0; variation < variationCount; variation++) {
      const info = await bank.addSprite(leaf, 0, variation);
      if (info.shadow) {
        shadows.push(bank.toVariant(info));
      } else {
        visible.push(bank.toVariant(info));
        centers.push(alphaCenterY(bank, info));
      }
    }
  }
  return {
    visible,
    shadows,
    centerY:
      centers.length === 0 ? null : centers.reduce((sum, value) => sum + value, 0) / centers.length,
  };
}

export function foldMissingRailFenceDirections(samples: RailFenceSample[]): void {
  if (samples.length !== 8) return;
  for (let i = 0; i < 4; i++) {
    const opposite = samples[i + 4];
    if (opposite && opposite.visible.length === 0 && opposite.shadows.length === 0) {
      const authored = samples[i];
      if (authored) samples[i + 4] = authored;
    }
  }
}

export function appendRailFencePartGroups(
  groups: LayerGroup[],
  sideA: RailFenceSample[],
  sideB: RailFenceSample[],
  sideAIsFront: boolean[],
  indexing: LayerGroup["indexing"],
  backLayer: RenderLayerName,
  frontLayer: RenderLayerName,
): void {
  const sides = [
    { samples: sideA, isA: true },
    { samples: sideB, isA: false },
  ] as const;

  for (const { samples, isA } of sides) {
    const visibleCount = Math.max(0, ...samples.map((sample) => sample.visible.length));
    for (let leaf = 0; leaf < visibleCount; leaf++) {
      for (const role of ["back", "front"] as const) {
        const variants = samples.map((sample, direction) => {
          const isFront = sideAIsFront[direction] === isA;
          return (role === "front") === isFront ? (sample.visible[leaf] ?? null) : null;
        });
        if (variants.every((variant) => variant == null)) continue;
        groups.push({
          layer: role === "front" ? frontLayer : backLayer,
          indexing,
          variants: { default: variants },
        });
      }
    }

    const shadowCount = Math.max(0, ...samples.map((sample) => sample.shadows.length));
    for (let leaf = 0; leaf < shadowCount; leaf++) {
      const variants = samples.map((sample) => sample.shadows[leaf] ?? null);
      if (variants.every((variant) => variant == null)) continue;
      groups.push({
        layer: fpsrLayer("shadow", "draw_as_shadow rail fence leaf"),
        indexing,
        variants: { default: variants },
      });
    }
  }
}

/**
 * Distill the continuous red guard rails on elevated rails and ramps.
 * Fence sides swap between the official back/front layers by direction; use
 * their alpha centroid to make the same screen-space choice without engine
 * rail-segment state. Endpoint-specific fence sprites remain an M3 concern.
 */
export async function addRailFenceGraphics(
  bank: FrameBank,
  raw: unknown,
  directionKeys: readonly string[],
  indexing: LayerGroup["indexing"],
): Promise<LayerGroup[]> {
  const fences = raw as RailFenceGraphicsSet | undefined;
  if (!fences?.side_A || !fences.side_B) return [];

  const samplePart = async (part: "fence" | "fence_upper") => {
    const sideA: RailFenceSample[] = [];
    const sideB: RailFenceSample[] = [];
    // Keep FrameBank registration deterministic; parallel image crops could
    // otherwise assign content-addressed frame IDs in completion order.
    for (const key of directionKeys) {
      sideA.push(await sampleRailFence(bank, fences.side_A?.[part]?.[key]));
      sideB.push(await sampleRailFence(bank, fences.side_B?.[part]?.[key]));
    }
    foldMissingRailFenceDirections(sideA);
    foldMissingRailFenceDirections(sideB);
    return { sideA, sideB };
  };

  const lower = await samplePart("fence");
  const sideAIsFront = lower.sideA.map((sampleA, direction) => {
    const sampleB = lower.sideB[direction];
    if (sampleA.centerY == null || sampleB?.centerY == null) return false;
    return sampleA.centerY > sampleB.centerY;
  });

  const backLayer =
    officialLayer(fences.back_fence_render_layer) ??
    guessedLayer("elevated-lower-object", "default RailFenceGraphicsSet back layer");
  const frontLayer =
    officialLayer(fences.front_fence_render_layer) ??
    guessedLayer("elevated-higher-object", "default RailFenceGraphicsSet front layer");
  const backSecondary =
    officialLayer(fences.back_fence_render_layer_secondary) ??
    guessedLayer("elevated-lower-object", "default RailFenceGraphicsSet secondary back layer");
  const frontSecondary =
    officialLayer(fences.front_fence_render_layer_secondary) ??
    guessedLayer("elevated-higher-object", "default RailFenceGraphicsSet secondary front layer");

  const groups: LayerGroup[] = [];
  appendRailFencePartGroups(
    groups,
    lower.sideA,
    lower.sideB,
    sideAIsFront,
    indexing,
    backLayer,
    frontLayer,
  );

  const upper = await samplePart("fence_upper");
  appendRailFencePartGroups(
    groups,
    upper.sideA,
    upper.sideB,
    sideAIsFront,
    indexing,
    backSecondary,
    frontSecondary,
  );
  return groups;
}

export async function distillRail(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  elevated: boolean,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, Record<string, RawSprite>> | undefined;
  if (!pictures) return baseEntity("rail", protoType, p, []);

  // Pieces we emit, in draw order (background → metal).
  // TODO(M3): also emit rail_endings when neighbor logic exists.
  const pieces = elevated
    ? (["stone_path_background", "stone_path", "backplates", "metals"] as const)
    : (["stone_path_background", "stone_path", "ties", "backplates", "metals"] as const);

  const groups: LayerGroup[] = [];

  for (const piece of pieces) {
    const layer = railPieceLayer(pictures as Record<string, unknown>, piece, elevated);
    if (!layer) continue;
    const samples: RailPieceSample[] = [];
    for (let i = 0; i < 8; i++) {
      const key = RAIL_DIR8_KEYS[i];
      const dirPics = key ? pictures[key] : undefined;
      const spr = dirPics?.[piece];
      samples.push(await sampleRailPiece(bank, spr));
    }
    appendRailPieceGroups(groups, samples, "direction8", layer);
  }

  if (elevated) {
    groups.push(
      ...(await addRailFenceGraphics(bank, p.fence_pictures, RAIL_DIR8_KEYS, "direction8")),
    );
  }

  return baseEntity("rail", protoType, p, groups);
}

export async function distillRailRamp(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  // Ramp: 4 cardinal picture keys; layers from dump render_layers when present.
  // TODO(M3): fog_mask, dual secondary_render_layers.
  const pictures = p.pictures as Record<string, Record<string, RawSprite>> | undefined;
  const cardKeys = ["north", "east", "south", "west"] as const;
  const pieces = ["stone_path_background", "stone_path", "ties"] as const;
  const groups: LayerGroup[] = [];
  for (const piece of pieces) {
    const layer = railPieceLayer(pictures as Record<string, unknown> | undefined, piece, true);
    const samples: RailPieceSample[] = [];
    for (const key of cardKeys) {
      samples.push(await sampleRailPiece(bank, pictures?.[key]?.[piece]));
    }
    appendRailPieceGroups(groups, samples, "direction4", layer);
  }
  groups.push(...(await addRailFenceGraphics(bank, p.fence_pictures, cardKeys, "direction4")));
  return baseEntity("rail", "rail-ramp", p, groups);
}

export async function distillRailSupport(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as { structure?: RawSprite; render_layer?: string } | undefined;
  const graphics = await layersFromSprite(bank, gs?.structure, {
    layer:
      officialLayer(gs?.render_layer) ??
      guessedLayer("object", "default RailSupportGraphicsSet render layer"),
    indexing: "direction8",
  });
  return baseEntity("simple", "rail-support", p, graphics);
}

export async function distillRailSignal(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  // TODO(M3): elevated_picture_set + elevation offset when signal sits on elevated rail.
  const gps = p.ground_picture_set as {
    structure?: RawSprite;
    structure_render_layer?: string;
    circuit_connector?: unknown;
  };
  // OFFICIAL: ground_picture_set.structure_render_layer (e.g. floor-mechanics).
  const structureLayer =
    officialLayer(gps?.structure_render_layer) ??
    guessedLayer("object", "rail signal structure; dump missing structure_render_layer");
  const graphics = await layersFromSprite(bank, gps?.structure, {
    layer: structureLayer,
    indexing: "direction16",
    frame: 0, // idle / green frame of the 3-frame light sheet
  });
  // Attach circuit anchors from the picture set.
  const withCc = {
    ...p,
    circuit_connector: gps?.circuit_connector ?? p.circuit_connector,
  };
  return withWireAnchors(baseEntity("rail-signal", protoType, p, graphics), withCc);
}

/** Max distilled train poses (atlas budget). */
