import { fpsrLayer, guessedLayer, officialLayer } from "../render-layers.js";
import { isSprite4Way, leafLayers, round4, type FrameBank } from "../sprite.js";
import type {
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
  distillDirection4Animation,
  distillGraphicsSetAnimation,
  layersFromSprite,
  skipIdleDecorativeLeaf,
  type WorkingVisualisation,
} from "./shared/layers.js";
import {
  HEAT_PIPE_MASK_KEYS,
  fluidWorkingVisualisationGroupsFromBoxes,
  withFluidData,
  type RawPipeConnection,
} from "./shared/pipe.js";

export async function distillMiningDrill(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
        working_visualisations?: WorkingVisualisation[];
      }
    | undefined;
  const groups: LayerGroup[] = [];
  const baseAnim =
    gs?.animation ??
    gs?.idle_animation ??
    (p.animations as RawSprite | undefined) ??
    (p.animation as RawSprite | undefined);
  groups.push(
    ...(await layersFromSprite(bank, baseAnim, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "direction4",
      frame: 0,
    })),
  );
  await appendIdleWorkingVisualisations(bank, groups, gs?.working_visualisations);
  return withFluidData(baseEntity("simple", protoType, p, groups), p);
}

export async function distillAssembler(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
        working_visualisations?: WorkingVisualisation[];
        integration_patch?: RawSprite;
        integration_patch_render_layer?: string;
      }
    | undefined;
  const anim = gs?.animation ?? gs?.idle_animation ?? (p.animation as RawSprite | undefined);
  const indexing = anim && isSprite4Way(anim) ? "direction4" : "single";
  const groups: LayerGroup[] = [];
  await appendIntegrationPatch(bank, groups, gs);
  groups.push(
    ...(await layersFromSprite(bank, anim, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing,
      frame: 0,
    })),
  );
  const namedWvGroups = await appendIdleWorkingVisualisations(
    bank,
    groups,
    gs?.working_visualisations,
  );
  const fluidWvGroups = fluidWorkingVisualisationGroupsFromBoxes(p, namedWvGroups);
  return withFluidData(
    baseEntity("assembler", protoType, p, groups),
    p,
    fluidWvGroups ? { fluidWorkingVisualisationGroups: fluidWvGroups } : undefined,
  );
}

/**
 * Thruster body is only the nozzle stack; `integration_patch` is the platform
 * mount, and always_draw WVs are the pipe stubs at the platform edge.
 */

export interface CranePartRaw {
  name?: string;
  rotated_sprite?: RawSprite;
  rotated_sprite_shadow?: RawSprite;
}

/** Crane Vector3D is (x, y, z-up). Body lifts Z into screen -Y. */
export const CRANE_HEIGHT_TO_Y = 0.5;

export function cranePartScreenPos(
  origin: readonly number[] | undefined,
  shadowDirection: readonly number[] | undefined,
  kind: "body" | "shadow",
): [number, number] {
  const ox = origin?.[0] ?? 0;
  const oy = origin?.[1] ?? 0;
  const oz = origin?.[2] ?? 0;
  if (kind === "body") {
    return [ox, oy - oz * CRANE_HEIGHT_TO_Y];
  }
  // shadow_direction points toward the light (positive z). Cast the elevated
  // point onto the ground plane z=0 opposite the light so the shadow sits under
  // the crane rather than floating at hub height.
  const sx = shadowDirection?.[0] ?? 0;
  const sy = shadowDirection?.[1] ?? 0;
  const sz = shadowDirection?.[2] ?? 0;
  if (oz > 0 && sz > 1e-6) {
    const t = oz / sz;
    return [ox - sx * t, oy - sy * t];
  }
  return [ox, oy];
}

/**
 * Agricultural-tower `graphics_set.animation` is only the base silo. The crane
 * hub lives under `crane.parts` as rotated sprites. Blueprint idle draws the
 * hub at `crane.origin` (Z→screen Y) above the silo, and casts its shadow onto
 * the ground via `shadow_direction`. Full articulated arm FK is deferred.
 */
export async function distillAgriculturalTower(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
        working_visualisations?: WorkingVisualisation[];
      }
    | undefined;
  const groups: LayerGroup[] = [];
  const baseAnim = gs?.animation ?? gs?.idle_animation;
  groups.push(
    ...(await layersFromSprite(bank, baseAnim, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      frame: 0,
    })),
  );
  await appendIdleWorkingVisualisations(bank, groups, gs?.working_visualisations);

  const crane = p.crane as
    | {
        origin?: number[];
        shadow_direction?: number[];
        parts?: CranePartRaw[];
      }
    | undefined;
  const hub = crane?.parts?.find((part) => part.name === "hub") ?? crane?.parts?.[0] ?? undefined;
  const bodyPos = cranePartScreenPos(crane?.origin, crane?.shadow_direction, "body");
  const shadowPos = cranePartScreenPos(crane?.origin, crane?.shadow_direction, "shadow");

  for (const [sprite, pos] of [
    [hub?.rotated_sprite, bodyPos],
    [hub?.rotated_sprite_shadow, shadowPos],
  ] as const) {
    if (!sprite) continue;
    for (const leaf of leafLayers(sprite)) {
      if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
      const info = await bank.addSprite(leaf, 0, 0);
      // Same-layer Y-sort buries the hub under the silo body.
      const layerName: RenderLayerName = info.shadow
        ? fpsrLayer("shadow", "draw_as_shadow leaf")
        : guessedLayer("higher-object-under", "agricultural-tower crane hub above silo body");
      groups.push({
        layer: layerName,
        indexing: "single",
        variants: {
          default: [
            bank.toVariant(info, [round4(info.shift[0] + pos[0]), round4(info.shift[1] + pos[1])]),
          ],
        },
      });
    }
  }

  return baseEntity("simple", protoType, p, groups);
}

export async function distillHeatPipe(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.connection_sprites as Record<string, RawSprite | RawSprite[]>;
  const objectVariants: Record<string, (SpriteVariant | null)[]> = {};

  for (const [mask, key] of Object.entries(HEAT_PIPE_MASK_KEYS)) {
    const raw = pictures[key];
    const spr = Array.isArray(raw) ? raw[0] : raw;
    if (!spr) {
      objectVariants[mask] = [null];
      continue;
    }
    const leaves = leafLayers(spr).filter((l) => !l.draw_as_shadow);
    const leaf = leaves[0];
    if (!leaf) {
      objectVariants[mask] = [null];
      continue;
    }
    const info = await bank.addSprite(leaf, 0, 0);
    objectVariants[mask] = [bank.toVariant(info)];
  }

  return withFluidData(
    baseEntity("heat-pipe", "heat-pipe", p, [
      {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        variants: objectVariants,
      },
    ]),
    p,
  );
}

export async function distillBoiler(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, { structure?: RawSprite }> | undefined;
  if (pictures?.north?.structure) {
    // Explicit 4-way structure under pictures.north/east/south/west
    const groups = new Map<string, LayerGroup>();
    const dirs = ["north", "east", "south", "west"] as const;
    for (let di = 0; di < 4; di++) {
      const dirName = dirs[di];
      if (dirName === undefined) continue;
      const struct = pictures[dirName]?.structure;
      if (!struct) continue;
      const leaves = leafLayers(struct);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump");
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
    return withFluidData(baseEntity("simple", protoType, p, [...groups.values()]), p);
  }
  return withFluidData(await distillDirection4Animation(bank, p, protoType, "simple"), p);
}

export async function distillOffshorePump(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as { animation?: RawSprite; base_pictures?: RawSprite } | undefined;
  const groups: LayerGroup[] = [];
  if (gs?.base_pictures) {
    groups.push(
      ...(await layersFromSprite(bank, gs.base_pictures, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "direction4",
        frame: 0,
      })),
    );
  }
  if (gs?.animation) {
    groups.push(
      ...(await layersFromSprite(bank, gs.animation, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "direction4",
        frame: 0,
      })),
    );
  }
  if (groups.length === 0) {
    return withFluidData(await distillDirection4Animation(bank, p, "offshore-pump", "simple"), p);
  }
  return withFluidData(baseEntity("simple", "offshore-pump", p, groups), p);
}

export async function distillSteamEngine(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, { animation?: RawSprite }> | undefined;
  // steam-engine/turbine only author north + east; south/west mirror.
  if (pictures?.north?.animation || pictures?.east?.animation) {
    const groups = new Map<string, LayerGroup>();
    const sample = async (dirName: "north" | "east", di: number) => {
      const anim = pictures[dirName]?.animation;
      if (!anim) return;
      const leaves = leafLayers(anim);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump");
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
    };
    await sample("north", 0);
    await sample("east", 1);
    // Copy N→S, E→W as approximation (game mirrors).
    for (const g of groups.values()) {
      const arr = g.variants.default;
      if (!arr) continue;
      arr[2] = arr[0] ?? null;
      arr[3] = arr[1] ?? null;
    }
    return withFluidData(baseEntity("simple", protoType, p, [...groups.values()]), p);
  }
  return withFluidData(await distillDirection4Animation(bank, p, protoType, "simple"), p);
}

export async function distillReactor(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const lowerGraphics = await layersFromSprite(
    bank,
    p.lower_layer_picture as RawSprite | undefined,
    {
      layer: guessedLayer("lower-object", "reactor lower_layer_picture; engine-assigned layer"),
      indexing: "single",
    },
  );
  const connections = (p.heat_buffer as { connections?: RawPipeConnection[] } | undefined)
    ?.connections;
  const patchGraphics = await distillReactorConnectionPatches(
    bank,
    p.connection_patches_connected as RawSprite | undefined,
    p.connection_patches_disconnected as RawSprite | undefined,
    connections?.length ?? 0,
  );
  const pic = p.picture as RawSprite | undefined;
  const bodyGraphics = await layersFromSprite(bank, pic, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
  });
  const graphics = [...lowerGraphics, ...patchGraphics, ...bodyGraphics];
  const patchStart = lowerGraphics.length;
  return withFluidData(baseEntity("simple", "reactor", p, graphics), p, {
    heatConnectionPatchGroupIndices: patchGraphics.map((_, index) => patchStart + index),
  });
}

/** Cold/static reactor connection patches, one variation per heat-buffer port. */
export async function distillReactorConnectionPatches(
  bank: FrameBank,
  connected: RawSprite | undefined,
  disconnected: RawSprite | undefined,
  portCount: number,
): Promise<LayerGroup[]> {
  if (portCount === 0) return [];
  const connectedLeaves = leafLayers(connected).filter((leaf) => !skipIdleDecorativeLeaf(leaf));
  const disconnectedLeaves = leafLayers(disconnected).filter(
    (leaf) => !skipIdleDecorativeLeaf(leaf),
  );
  const groups: LayerGroup[] = [];
  const leafCount = Math.max(connectedLeaves.length, disconnectedLeaves.length);
  for (let leafIndex = 0; leafIndex < leafCount; leafIndex++) {
    const connectedLeaf = connectedLeaves[leafIndex];
    const disconnectedLeaf = disconnectedLeaves[leafIndex];
    const connectedVariants: (SpriteVariant | null)[] = [];
    const disconnectedVariants: (SpriteVariant | null)[] = [];
    let layer: RenderLayerName | undefined;
    for (let port = 0; port < portCount; port++) {
      if (connectedLeaf) {
        const info = await bank.addSprite(connectedLeaf, 0, port);
        connectedVariants.push(bank.toVariant(info));
        layer ??= info.shadow
          ? fpsrLayer("shadow", "reactor connected patch shadow")
          : guessedLayer("lower-object", "reactor connected patch; engine-assigned layer");
      } else {
        connectedVariants.push(null);
      }
      if (disconnectedLeaf) {
        const info = await bank.addSprite(disconnectedLeaf, 0, port);
        disconnectedVariants.push(bank.toVariant(info));
        layer ??= info.shadow
          ? fpsrLayer("shadow", "reactor disconnected patch shadow")
          : guessedLayer("lower-object", "reactor disconnected patch; engine-assigned layer");
      } else {
        disconnectedVariants.push(null);
      }
    }
    if (layer) {
      groups.push({
        layer,
        indexing: "resolver",
        variants: { connected: connectedVariants, disconnected: disconnectedVariants },
      });
    }
  }
  return groups;
}

export async function distillBeacon(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as {
    animation_list?: {
      animation: RawSprite;
      render_layer?: string;
      always_draw?: boolean;
    }[];
    module_visualisations?: {
      art_style?: string;
      use_for_empty_slots?: boolean;
      slots?: {
        has_empty_slot?: boolean;
        render_layer?: string;
        pictures?: RawSprite;
        apply_module_tint?: string;
      }[][];
    }[];
  };
  const groups: LayerGroup[] = [];
  for (const entry of gs.animation_list ?? []) {
    // The static blueprint renderer represents an idle/unpowered beacon. Optional
    // module-tinted and light animations use additive blending in Factorio; drawing
    // their opaque-black source sheets normally produces a large black rectangle.
    if (entry.always_draw === false) continue;
    // OFFICIAL: graphics_set.animation_list[].render_layer from dump.
    const layer =
      officialLayer(entry.render_layer) ??
      guessedLayer("object", "beacon animation_list entry missing render_layer");
    const parts = await layersFromSprite(bank, entry.animation, {
      layer,
      indexing: "single",
      frame: 0,
    });
    groups.push(...parts);
  }

  // beacon-bottom has painted module-slot recesses that read as black holes without
  // the empty-slot chrome Factorio draws via module_visualisations. Blueprint view
  // uses that non-module (empty-slot) cover — not the tinted/filled module layers.
  for (const style of gs.module_visualisations ?? []) {
    if (!style.use_for_empty_slots) continue;
    for (const slotLayers of style.slots ?? []) {
      for (const vis of slotLayers) {
        if (!vis.has_empty_slot || !vis.pictures) continue;
        if (vis.pictures.draw_as_light || vis.apply_module_tint) continue;
        const layer =
          officialLayer(vis.render_layer) ??
          guessedLayer("lower-object", "beacon empty module slot missing render_layer");
        // Variation 0 is the empty-slot cover (has_empty_slot sheet).
        const info = await bank.addSprite(vis.pictures, 0, 0);
        groups.push({
          layer,
          indexing: "single",
          variants: { default: [bank.toVariant(info)] },
        });
      }
    }
  }

  return baseEntity("simple", "beacon", p, groups);
}

export async function distillLab(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const off = p.off_animation as RawSprite;
  const graphics = await layersFromSprite(bank, off, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
    frame: 0,
  });
  return baseEntity("simple", "lab", p, graphics);
}

export async function distillAccumulator(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const cg = p.chargable_graphics as { picture?: RawSprite };
  const graphics = await layersFromSprite(bank, cg.picture, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
  });
  return baseEntity("simple", "accumulator", p, graphics);
}

export async function distillFusionGenerator(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        north_graphics_set?: { animation?: RawSprite };
        east_graphics_set?: { animation?: RawSprite };
        south_graphics_set?: { animation?: RawSprite };
        west_graphics_set?: { animation?: RawSprite };
      }
    | undefined;
  if (gs?.north_graphics_set?.animation || gs?.east_graphics_set?.animation) {
    const dirs = [
      gs.north_graphics_set?.animation,
      gs.east_graphics_set?.animation,
      gs.south_graphics_set?.animation,
      gs.west_graphics_set?.animation,
    ] as const;
    const leafGroups = new Map<string, LayerGroup>();
    for (let di = 0; di < 4; di++) {
      const anim = dirs[di] ?? dirs[0];
      if (!anim) continue;
      let leafIdx = 0;
      for (const leaf of leafLayers(anim)) {
        if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump");
        const key = `${layerName}:${leafIdx}`;
        leafIdx++;
        let g = leafGroups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { default: [null, null, null, null] },
          };
          leafGroups.set(key, g);
        }
        const arr = g.variants.default;
        if (arr) arr[di] = bank.toVariant(info);
      }
    }
    return withFluidData(baseEntity("simple", "fusion-generator", p, [...leafGroups.values()]), p);
  }
  return distillFusion(bank, p, "fusion-generator");
}

export async function distillFusion(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        structure?: RawSprite;
        animation?: RawSprite;
        /** Idle neighbour-port patches; main structure has transparent cutouts here. */
        connections_graphics?: Array<{ pictures?: RawSprite }>;
      }
    | undefined;
  if (gs?.structure) {
    const graphics = await layersFromSprite(bank, gs.structure, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
    });
    // Frame 0 = unconnected port cover. Connected neighbour states are runtime.
    for (const conn of gs.connections_graphics ?? []) {
      if (!conn.pictures) continue;
      graphics.push(
        ...(await layersFromSprite(bank, conn.pictures, {
          layer: guessedLayer("object", "fusion reactor idle connection patch"),
          indexing: "single",
          frame: 0,
        })),
      );
    }
    return withFluidData(baseEntity("simple", protoType, p, graphics), p);
  }
  return withFluidData(await distillGraphicsSetAnimation(bank, p, protoType, "simple"), p);
}
