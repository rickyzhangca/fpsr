import { isSprite4Way, leafLayers, type FrameBank } from "../sprite.js";
import { fpsrLayer, guessedLayer, officialLayer } from "../render-layers.js";
import type {
  CargoBayConnectionCell,
  CargoBayConnectionLayer,
  CargoBayConnections,
  EntityKind,
  EntityRenderDef,
  LayerGroup,
  RawSprite,
  RenderLayerName,
  SpriteVariant,
} from "../types.js";
import {
  appendIdleWorkingVisualisations,
  appendIntegrationPatch,
  baseEntity,
  layersFromSprite,
  skipIdleDecorativeLeaf,
  type WorkingVisualisation,
} from "./shared/layers.js";
import { withFluidData } from "./shared/pipe.js";

export async function distillThruster(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        integration_patch?: RawSprite;
        integration_patch_render_layer?: string;
        working_visualisations?: WorkingVisualisation[];
      }
    | undefined;
  const groups: LayerGroup[] = [];
  await appendIntegrationPatch(bank, groups, gs);
  groups.push(
    ...(await layersFromSprite(bank, gs?.animation, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      frame: 0,
    })),
  );
  await appendIdleWorkingVisualisations(bank, groups, gs?.working_visualisations);
  return withFluidData(baseEntity("simple", "thruster", p, groups), p);
}

/**
 * Asteroid-collector top animation is only the head shell (transparent hopper
 * opening). `below_*` hang under the platform edge; `arm_head*` is the idle
 * grabber that sits in that opening. Full arm-link FK is deferred.
 */
export async function distillAsteroidCollector(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        below_ground_pictures?: RawSprite;
        below_arm_pictures?: RawSprite;
        arm_head_animation?: RawSprite;
        arm_head_top_animation?: RawSprite;
      }
    | undefined;
  const groups: LayerGroup[] = [];
  groups.push(
    ...(await layersFromSprite(bank, gs?.below_ground_pictures, {
      layer: guessedLayer("lower-object", "asteroid-collector below_ground under platform edge"),
      indexing: "single",
      frame: 0,
    })),
  );
  // Must paint above the entity shadow: the head shell has a transparent hopper
  // opening, and a shadow-under-hole reads as a solid black void.
  groups.push(
    ...(await layersFromSprite(bank, gs?.below_arm_pictures, {
      layer: guessedLayer("object", "asteroid-collector below_arm visible through hopper opening"),
      indexing: "single",
      frame: 0,
    })),
  );
  const animIndexing = gs?.animation && isSprite4Way(gs.animation) ? "direction4" : "single";
  groups.push(
    ...(await layersFromSprite(bank, gs?.animation, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: animIndexing,
      frame: 0,
    })),
  );

  // 32-way head sheets: map N/E/S/W → directions 0/8/16/24, idle frame 0.
  for (const arm of [gs?.arm_head_animation, gs?.arm_head_top_animation]) {
    if (!arm) continue;
    const dirCount = arm.direction_count ?? 1;
    if (dirCount < 4) {
      groups.push(
        ...(await layersFromSprite(bank, arm, {
          layer: guessedLayer("object", "asteroid-collector idle arm head"),
          indexing: "single",
          frame: 0,
        })),
      );
      continue;
    }
    const step = Math.max(1, Math.round(dirCount / 4));
    const variants: (SpriteVariant | null)[] = [];
    for (let di = 0; di < 4; di++) {
      const info = await bank.addSprite(arm, 0, (di * step) % dirCount);
      variants.push(bank.toVariant(info));
    }
    groups.push({
      layer: guessedLayer("object", "asteroid-collector idle arm head"),
      indexing: "direction4",
      variants: { default: variants },
    });
  }

  return baseEntity("simple", "asteroid-collector", p, groups);
}

export async function distillRocketSilo(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  for (const field of ["shadow_sprite", "base_day_sprite", "base_front_sprite"] as const) {
    const spr = p[field] as RawSprite | undefined;
    if (!spr) continue;
    groups.push(
      ...(await layersFromSprite(bank, spr, {
        layer:
          field === "shadow_sprite"
            ? fpsrLayer("shadow", "rocket-silo shadow_sprite")
            : guessedLayer("object", "rocket-silo body; not in dump"),
        indexing: "single",
      })),
    );
  }
  return baseEntity("simple", "rocket-silo", p, groups);
}

export async function distillGraphicsSetPictureArray(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind = "simple",
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        picture?: RawSprite | RawSprite[] | Record<string, RawSprite | RawSprite[]>;
        animation?: RawSprite;
        idle_animation?: RawSprite;
        structure?: RawSprite;
        connections?: RawCargoBayConnections;
      }
    | undefined;
  const pgs = p.platform_graphics_set as
    | {
        picture?: RawSprite | RawSprite[] | Record<string, RawSprite | RawSprite[]>;
        connections?: RawCargoBayConnections;
      }
    | undefined;

  let grounded = await distillPictureSet(bank, gs?.picture, "default");
  if (grounded.length === 0 && gs?.structure) {
    grounded = await distillPictureSet(bank, gs.structure, "default");
  }
  if (grounded.length === 0 && (gs?.animation || gs?.idle_animation)) {
    grounded = await layersFromSprite(bank, gs.animation ?? gs.idle_animation, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      frame: 0,
      variantKey: "default",
    });
  }

  const platform = await distillPictureSet(bank, pgs?.picture, "default");

  let groups: LayerGroup[];
  if (grounded.length > 0 && platform.length > 0) {
    groups = mergePlatformBodyVariants(grounded, platform);
  } else if (grounded.length > 0) {
    groups = grounded;
  } else {
    groups = platform;
  }

  await appendCargoStationIdleHatches(bank, groups, p);

  const def = baseEntity(kind, protoType, p, groups);
  const connections = await distillCargoBayConnections(bank, gs?.connections);
  const connectionsPlatform = await distillCargoBayConnections(bank, pgs?.connections);
  if (connections || connectionsPlatform) {
    def.data = {
      ...def.data,
      ...(connections ? { cargoBayConnections: connections } : {}),
      ...(connectionsPlatform
        ? { cargoBayConnectionsPlatform: connectionsPlatform }
        : connections
          ? { cargoBayConnectionsPlatform: connections }
          : {}),
    };
  }
  return def;
}

/** Dump shape for Factorio 2.1 CargoBayConnections. */
export type RawCargoBayConnections = {
  tileset?: unknown;
  tileset_mapping?: Record<string, number | number[]>;
  bridge_horizontal_narrow?: unknown;
  bridge_vertical_narrow?: unknown;
  bridge_horizontal_wide?: unknown;
  bridge_vertical_wide?: unknown;
  bridge_crossing?: unknown;
};

/**
 * Distill a graphics_set.picture (array / 4-way / single) into LayerGroups,
 * honoring each picture-array entry's official `render_layer`.
 */
export async function distillPictureSet(
  bank: FrameBank,
  pics: RawSprite | RawSprite[] | Record<string, RawSprite | RawSprite[]> | undefined,
  variantKey: string,
): Promise<LayerGroup[]> {
  if (!pics) return [];
  const groups: LayerGroup[] = [];

  const addPic = async (pic: RawSprite | undefined) => {
    if (!pic) return;
    const layer =
      officialLayer(pic.render_layer) ??
      guessedLayer("object", "entity body; dump has no render_layer");
    groups.push(
      ...(await layersFromSprite(bank, pic, {
        layer,
        indexing: "single",
        variantKey,
      })),
    );
  };

  if (typeof pics === "object" && !Array.isArray(pics) && isSprite4Way(pics as RawSprite)) {
    const dirNames = ["north", "east", "south", "west"] as const;
    const leafGroups = new Map<string, LayerGroup>();
    for (let di = 0; di < 4; di++) {
      const dirName = dirNames[di];
      if (dirName === undefined) continue;
      const rawDir = (pics as Record<string, RawSprite | RawSprite[]>)[dirName];
      const list = Array.isArray(rawDir) ? rawDir : rawDir ? [rawDir] : [];
      let leafIdx = 0;
      for (const entry of list) {
        const entryLayer =
          officialLayer(entry.render_layer) ?? guessedLayer("object", "entity body; not in dump");
        for (const leaf of leafLayers(entry)) {
          if (skipIdleDecorativeLeaf(leaf)) continue;
          const info = await bank.addSprite(leaf, 0, 0);
          const layerName: RenderLayerName = info.shadow
            ? fpsrLayer("shadow", "draw_as_shadow leaf")
            : entryLayer;
          const key = `${layerName}:${leafIdx}`;
          leafIdx++;
          let g = leafGroups.get(key);
          if (!g) {
            g = {
              layer: layerName,
              indexing: "direction4",
              variants: { [variantKey]: [null, null, null, null] },
            };
            leafGroups.set(key, g);
          }
          const arr = g.variants[variantKey];
          if (arr) arr[di] = bank.toVariant(info);
        }
      }
    }
    groups.push(...leafGroups.values());
  } else if (Array.isArray(pics)) {
    for (const pic of pics) await addPic(pic);
  } else {
    await addPic(pics as RawSprite);
  }
  return groups;
}

/** Zip grounded + platform body groups into default/platform variant keys. */
export function mergePlatformBodyVariants(
  grounded: LayerGroup[],
  platform: LayerGroup[],
): LayerGroup[] {
  const n = Math.max(grounded.length, platform.length);
  const out: LayerGroup[] = [];
  for (let i = 0; i < n; i++) {
    const g = grounded[i];
    const p = platform[i];
    if (g && p) {
      out.push({
        layer: g.layer,
        indexing: g.indexing,
        variants: {
          default: g.variants.default ?? Object.values(g.variants)[0] ?? [null],
          platform: p.variants.default ?? Object.values(p.variants)[0] ?? [null],
        },
      });
    } else if (g) {
      out.push(g);
    } else if (p) {
      const body = p.variants.default ?? Object.values(p.variants)[0] ?? [null];
      out.push({
        layer: p.layer,
        indexing: p.indexing,
        variants: { default: body, platform: body },
      });
    }
  }
  return out;
}

export async function distillCargoBayConnectionCell(
  bank: FrameBank,
  variation: unknown,
): Promise<CargoBayConnectionCell | null> {
  const layersIn: RawSprite[] = Array.isArray(variation)
    ? (variation as RawSprite[])
    : variation && typeof variation === "object"
      ? [variation as RawSprite]
      : [];
  if (layersIn.length === 0) return null;

  const layers: CargoBayConnectionLayer[] = [];
  for (const entry of layersIn) {
    const entryLayer =
      officialLayer(entry.render_layer) ??
      guessedLayer("object", "cargo bay connection; dump has no render_layer");
    for (const leaf of leafLayers(entry)) {
      if (skipIdleDecorativeLeaf(leaf)) continue;
      const info = await bank.addSprite(leaf, 0, 0);
      const layer: RenderLayerName = info.shadow
        ? fpsrLayer("shadow", "draw_as_shadow leaf")
        : (officialLayer(leaf.render_layer) ?? entryLayer);
      layers.push({ layer, variant: bank.toVariant(info) });
    }
  }
  return layers.length > 0 ? { layers } : null;
}

export async function distillCargoBayConnectionVariations(
  bank: FrameBank,
  raw: unknown,
): Promise<CargoBayConnectionCell[]> {
  if (!raw) return [];
  const variations = Array.isArray(raw) ? raw : [raw];
  const out: CargoBayConnectionCell[] = [];
  for (const variation of variations) {
    const cell = await distillCargoBayConnectionCell(bank, variation);
    if (cell) out.push(cell);
  }
  return out;
}

export async function distillCargoBayConnections(
  bank: FrameBank,
  raw: RawCargoBayConnections | undefined,
): Promise<CargoBayConnections | undefined> {
  if (!raw?.tileset && !raw?.bridge_horizontal_narrow) return undefined;

  const tileset: CargoBayConnectionCell[][][] = [];
  const rawTileset = Array.isArray(raw.tileset) ? raw.tileset : [];
  for (const groups of rawTileset) {
    const groupArr: CargoBayConnectionCell[][] = [];
    const rawGroups = Array.isArray(groups) ? groups : [];
    for (const group of rawGroups) {
      groupArr.push(await distillCargoBayConnectionVariations(bank, group));
    }
    tileset.push(groupArr);
  }

  const tilesetMapping: Record<string, number | number[]> = {};
  for (const [k, v] of Object.entries(raw.tileset_mapping ?? {})) {
    tilesetMapping[k] = v;
  }

  return {
    tileset,
    tilesetMapping,
    bridges: {
      horizontalNarrow: await distillCargoBayConnectionVariations(
        bank,
        raw.bridge_horizontal_narrow,
      ),
      verticalNarrow: await distillCargoBayConnectionVariations(bank, raw.bridge_vertical_narrow),
      horizontalWide: await distillCargoBayConnectionVariations(bank, raw.bridge_horizontal_wide),
      verticalWide: await distillCargoBayConnectionVariations(bank, raw.bridge_vertical_wide),
      crossing: await distillCargoBayConnectionVariations(bank, raw.bridge_crossing),
    },
  };
}

/**
 * Closed cargo-hub giga hatches. Without these, hub-3's hatch pits read as
 * black voids against empty space.
 */
export async function appendCargoStationIdleHatches(
  bank: FrameBank,
  groups: LayerGroup[],
  p: Record<string, unknown>,
): Promise<void> {
  const csp = p.cargo_station_parameters as
    | {
        giga_hatch_definitions?: Array<{
          hatch_graphics_back?: RawSprite;
          hatch_graphics_front?: RawSprite;
          hatch_render_layer_back?: string;
          hatch_render_layer_front?: string;
        }>;
      }
    | undefined;
  for (const hatch of csp?.giga_hatch_definitions ?? []) {
    for (const [spr, rl] of [
      [hatch.hatch_graphics_back, hatch.hatch_render_layer_back],
      [hatch.hatch_graphics_front, hatch.hatch_render_layer_front],
    ] as const) {
      if (!spr) continue;
      const layer =
        officialLayer(rl) ??
        guessedLayer("object", "cargo station idle giga hatch; dump has no render_layer");
      groups.push(
        ...(await layersFromSprite(bank, spr, {
          layer,
          indexing: "single",
          frame: 0,
        })),
      );
    }
  }
}
