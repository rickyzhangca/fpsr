import {
  dirs4,
  isSprite4Way,
  leafLayers,
  normalizeShift,
  round4,
  type FrameBank,
} from "../../sprite.js";
import { fpsrLayer, guessedLayer, officialLayer } from "../../render-layers.js";
import type {
  EntityKind,
  EntityRenderDef,
  LayerGroup,
  RawSprite,
  RenderLayerName,
  SpriteVariant,
} from "../../types.js";
import { boxOf } from "./box.js";

export function skipIdleDecorativeLeaf(leaf: RawSprite): boolean {
  if (leaf.apply_runtime_tint || leaf.draw_as_light || leaf.draw_as_glow) return true;
  if (leaf.blend_mode === "additive" || leaf.blend_mode === "additive-soft") return true;
  return false;
}

export async function layersFromSprite(
  bank: FrameBank,
  sprite: RawSprite | undefined,
  opts: {
    layer: RenderLayerName;
    indexing: LayerGroup["indexing"];
    variantKey?: string;
    frame?: number;
    /** Force direction_count when sheet omits it (platform / UG structure). */
    assumeDirectionCount?: number;
    /** Sample 4 directions as horizontal columns (UG structure sheets). */
    sampleDirectionsAsColumns?: boolean;
  },
): Promise<LayerGroup[]> {
  if (!sprite) return [];
  const variantKey = opts.variantKey ?? "default";
  const frame = opts.frame ?? 0;

  // 4-way explicit
  if (isSprite4Way(sprite)) {
    const groups = new Map<string, LayerGroup>();
    const dirs = dirs4(sprite);
    for (let di = 0; di < 4; di++) {
      const leaves = leafLayers(dirs[di]);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (skipIdleDecorativeLeaf(leaf)) continue;
        const info = await bank.addSprite(leaf, frame, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : opts.layer;
        // One LayerGroup per leaf so multi-layer 4-ways (drills, etc.) keep all parts.
        const key = `${layerName}:${info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let g = groups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { [variantKey]: [null, null, null, null] },
          };
          groups.set(key, g);
        }
        const arr = g.variants[variantKey];
        if (!arr) continue;
        arr[di] = bank.toVariant(info);
      }
    }
    return [...groups.values()];
  }

  const leaves = leafLayers(sprite);
  const groups: LayerGroup[] = [];

  for (const leaf of leaves) {
    if (skipIdleDecorativeLeaf(leaf)) continue;
    const assumed = opts.assumeDirectionCount;
    const dirCount = leaf.direction_count ?? assumed ?? 1;
    /**
     * Structure/platform sheets often omit direction_count and pack the 4
     * directions horizontally (as consecutive "frames"). When we assumed the
     * count, sample via frame index on X rather than direction rows on Y.
     */
    const horizontalDirs =
      !opts.sampleDirectionsAsColumns && assumed != null && leaf.direction_count == null;

    const sample = async (d: number) => {
      // Horizontal direction packs: treat dir as frame column (must set
      // frame_count/line_length — bare addSprite(leaf, d, 0) samples rows on Y).
      if (opts.sampleDirectionsAsColumns || horizontalDirs) {
        const n = assumed ?? 4;
        const colLeaf = { ...leaf, line_length: n, frame_count: n, direction_count: 1 };
        return bank.addSprite(colLeaf, d, 0);
      }
      return bank.addSprite(leaf, frame, d);
    };

    const info0 = await sample(0);
    const layerName: RenderLayerName = info0.shadow
      ? fpsrLayer("shadow", "draw_as_shadow leaf")
      : opts.layer;

    if (dirCount <= 1) {
      groups.push({
        layer: layerName,
        indexing: "single",
        variants: { [variantKey]: [bank.toVariant(info0)] },
      });
      continue;
    }

    const variants: (SpriteVariant | null)[] = [];
    for (let d = 0; d < dirCount; d++) {
      const info = d === 0 ? info0 : await sample(d);
      variants.push(bank.toVariant(info));
    }
    const indexing: LayerGroup["indexing"] =
      dirCount === 4
        ? "direction4"
        : dirCount === 8
          ? "direction8"
          : dirCount === 16
            ? "direction16"
            : "resolver";
    groups.push({
      layer: layerName,
      indexing: dirCount === 4 ? "direction4" : indexing,
      variants: { [variantKey]: variants },
    });
  }
  return groups;
}

export async function mergeLayerGroups(groups: LayerGroup[]): Promise<LayerGroup[]> {
  // Keep as-is; callers already split shadow/object.
  return groups;
}

export function baseEntity(
  kind: EntityKind,
  protoType: string,
  p: Record<string, unknown>,
  graphics: LayerGroup[],
): EntityRenderDef {
  const rawSpec = p.icon_draw_specification as
    | {
        shift?: [number, number];
        scale?: number;
        scale_for_many?: number;
        render_layer?: "entity-info-icon" | "entity-info-icon-above" | "air-entity-info-icon";
      }
    | undefined;
  const collisionBox = boxOf(p, "collision_box");
  const selectionBox = boxOf(p, "selection_box");
  const explicitScale = p.quality_indicator_scale;
  const qualityIndicatorScale =
    typeof explicitScale === "number" && Number.isFinite(explicitScale)
      ? round4(explicitScale)
      : defaultQualityIndicatorScale(collisionBox);
  return {
    kind,
    protoType,
    collisionBox,
    selectionBox,
    graphics,
    qualityIndicatorScale,
    ...(rawSpec
      ? {
          iconDrawSpecification: {
            shift: normalizeShift(rawSpec.shift),
            scale: round4(rawSpec.scale ?? 1),
            scaleForMany: round4(rawSpec.scale_for_many ?? rawSpec.scale ?? 1),
            renderLayer: rawSpec.render_layer ?? "entity-info-icon",
          },
        }
      : {}),
  };
}

/** Factorio default: shorter tile span / 3, clamped to [0.5, 1]. Size 3 → scale 1. */
export function defaultQualityIndicatorScale(
  collisionBox: [[number, number], [number, number]],
): number {
  const [[x1, y1], [x2, y2]] = collisionBox;
  const tw = Math.max(1, Math.ceil(Math.abs(x2 - x1) - 1e-6));
  const th = Math.max(1, Math.ceil(Math.abs(y2 - y1) - 1e-6));
  return round4(Math.min(1, Math.max(0.5, Math.min(tw, th) / 3)));
}

export async function distillSimplePicture(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind = "simple",
  pictureField = "picture",
): Promise<EntityRenderDef> {
  const pic = p[pictureField] as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, pic, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
  });
  return baseEntity(kind, protoType, p, await mergeLayerGroups(graphics));
}

export async function distillGraphicsSetAnimation(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
      }
    | undefined;
  const anim = gs?.animation ?? gs?.idle_animation ?? (p.animation as RawSprite | undefined);
  const graphics = await layersFromSprite(bank, anim, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
    frame: 0,
  });
  return baseEntity(kind, protoType, p, graphics);
}

export async function distillDirection4Animation(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
      }
    | undefined;
  const anim =
    gs?.animation ??
    gs?.idle_animation ??
    (p.animations as RawSprite | undefined) ??
    (p.animation as RawSprite | undefined);
  const graphics = await layersFromSprite(bank, anim, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
    frame: 0,
  });
  return baseEntity(kind, protoType, p, graphics);
}

export interface WorkingVisualisation {
  always_draw?: boolean;
  apply_tint?: string;
  apply_recipe_tint?: string;
  render_layer?: string;
  draw_in_states?: string[];
  animation?: RawSprite;
  north_animation?: RawSprite;
  east_animation?: RawSprite;
  south_animation?: RawSprite;
  west_animation?: RawSprite;
}

export const RUNTIME_WORKING_VIS_TINTS = new Set([
  "resource-color",
  "status",
  "input-fluid-base-color",
  "input-fluid-flow-color",
  "visual-state-color",
]);

export const RECIPE_WORKING_VIS_TINTS = new Set(["primary", "secondary", "tertiary", "quaternary"]);

/** Static blueprint view = idle. Skip working-only / tinted runtime overlays. */
export function includeWorkingVisualisationForIdle(wv: WorkingVisualisation): boolean {
  if (wv.always_draw !== true) return false;
  if (wv.apply_tint && RUNTIME_WORKING_VIS_TINTS.has(wv.apply_tint)) return false;
  if (wv.apply_recipe_tint && RECIPE_WORKING_VIS_TINTS.has(wv.apply_recipe_tint)) return false;
  if (wv.draw_in_states && wv.draw_in_states.length > 0 && !wv.draw_in_states.includes("idle")) {
    return false;
  }
  return true;
}

/**
 * Mining-drill heads, pumpjack horseheads, EM-plant cores, foundry pipes, etc.
 * live in `graphics_set.working_visualisations` with `always_draw`, not in the
 * base `animation` / `idle_animation` (often just an empty frame).
 */
export async function layersFromWorkingVisualisation(
  bank: FrameBank,
  wv: WorkingVisualisation,
): Promise<LayerGroup[]> {
  const layer =
    officialLayer(wv.render_layer) ??
    guessedLayer("object", "working_visualisation; dump has no render_layer");
  const dirSprites = [
    wv.north_animation,
    wv.east_animation,
    wv.south_animation,
    wv.west_animation,
  ] as const;

  if (dirSprites.some((sprite) => sprite != null)) {
    // Mirror layersFromSprite's 4-way path, but keep missing directions as null
    // instead of dirs4's fallback to the parent object.
    const groups = new Map<string, LayerGroup>();
    for (let di = 0; di < 4; di++) {
      const leaves = leafLayers(dirSprites[di]);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (skipIdleDecorativeLeaf(leaf)) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : layer;
        const key = `${layerName}:${info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let g = groups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { default: [null, null, null, null] },
          };
          groups.set(key, g);
        }
        const arr = g.variants.default;
        if (arr) arr[di] = bank.toVariant(info);
      }
    }
    return [...groups.values()];
  }

  if (wv.animation) {
    return layersFromSprite(bank, wv.animation, {
      layer,
      indexing: "single",
      frame: 0,
    });
  }

  return [];
}

export async function appendIdleWorkingVisualisations(
  bank: FrameBank,
  groups: LayerGroup[],
  workingVisualisations: WorkingVisualisation[] | undefined,
): Promise<void> {
  for (const wv of workingVisualisations ?? []) {
    if (!includeWorkingVisualisationForIdle(wv)) continue;
    groups.push(...(await layersFromWorkingVisualisation(bank, wv)));
  }
}

/**
 * Floor/platform blend sprites (`integration_patch`). Drawn under the body so
 * thrusters/crushers don't float as nozzle/head-only cutouts.
 */
export async function appendIntegrationPatch(
  bank: FrameBank,
  groups: LayerGroup[],
  gs:
    | {
        integration_patch?: RawSprite;
        integration_patch_render_layer?: string;
      }
    | undefined,
): Promise<void> {
  if (!gs?.integration_patch) return;
  const layer =
    officialLayer(gs.integration_patch_render_layer) ??
    guessedLayer("floor", "integration_patch; dump has no render_layer");
  const indexing = isSprite4Way(gs.integration_patch) ? "direction4" : "single";
  groups.push(
    ...(await layersFromSprite(bank, gs.integration_patch, {
      layer,
      indexing,
      frame: 0,
    })),
  );
}
