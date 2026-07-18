import { createHash } from "node:crypto";
import { readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolveSpritePath } from "../paths.js";
import { fpsrLayer, guessedLayer } from "../render-layers.js";
import {
  averageColor,
  cropEntireFile,
  cropFileRect,
  imageDimensions,
  isSprite4Way,
  loadImageRgba,
  normalizeTint,
  round4,
  type FrameBank,
} from "../sprite.js";
import type {
  DataRaw,
  EntityKind,
  EntityRenderDef,
  RawSprite,
  SpaceBackground,
  TerrainBackgrounds,
  TerrainPatchBackground,
  TerrainPatchSet,
  TileRenderDef,
} from "../types.js";
import {
  WATER_SUPERTILE_TILES,
  bakeFrozenWaterSurface,
  type FrozenWaterParameters,
} from "../water-effect.js";
import { proto } from "./shared/box.js";
import { hasUsableGraphics } from "./shared/finalize.js";
import { baseEntity, layersFromSprite } from "./shared/layers.js";
import { distillGraphicsSetPictureArray } from "./space.js";

export async function distillGenericFallback(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind,
): Promise<EntityRenderDef> {
  // Try common Factorio graphics fields in priority order.
  const candidates: (RawSprite | undefined)[] = [
    (p.graphics_set as { animation?: RawSprite } | undefined)?.animation,
    (p.graphics_set as { idle_animation?: RawSprite } | undefined)?.idle_animation,
    (p.graphics_set as { structure?: RawSprite } | undefined)?.structure,
    Array.isArray((p.graphics_set as { picture?: unknown } | undefined)?.picture)
      ? undefined
      : ((p.graphics_set as { picture?: RawSprite } | undefined)?.picture as RawSprite | undefined),
    p.picture as RawSprite | undefined,
    p.pictures as RawSprite | undefined,
    p.sprites as RawSprite | undefined,
    p.sprite as RawSprite | undefined,
    p.animation as RawSprite | undefined,
    p.animations as RawSprite | undefined,
    p.idle as RawSprite | undefined,
    p.picture_off as RawSprite | undefined,
    p.picture_safe as RawSprite | undefined,
    p.power_on_animation as RawSprite | undefined,
    p.off_animation as RawSprite | undefined,
    p.base as RawSprite | undefined,
    (p.chargable_graphics as { picture?: RawSprite } | undefined)?.picture,
    (p.robot_door as { animation?: RawSprite } | undefined)?.animation,
  ];

  // graphics_set.picture as array
  const picArr = (p.graphics_set as { picture?: RawSprite[] } | undefined)?.picture;
  if (Array.isArray(picArr) && picArr.length > 0) {
    return distillGraphicsSetPictureArray(bank, p, protoType, kind);
  }

  for (const spr of candidates) {
    if (!spr) continue;
    const graphics = await layersFromSprite(bank, spr, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: isSprite4Way(spr) ? "direction4" : "single",
      frame: 0,
    });
    if (graphics.length > 0 && hasUsableGraphics(baseEntity(kind, protoType, p, graphics))) {
      return baseEntity(kind, protoType, p, graphics);
    }
  }
  return baseEntity(kind, protoType, p, []);
}

export async function distillIcon(
  bank: FrameBank,
  raw: DataRaw,
  category:
    | "item"
    | "recipe"
    | "fluid"
    | "virtual-signal"
    | "quality"
    | "entity"
    | "space-location"
    | "asteroid-chunk",
  name: string,
  protoTypeHint?: string,
): Promise<number | undefined> {
  const tryProto = (type: string, n: string): Record<string, unknown> | undefined => {
    const p = raw[type]?.[n] as Record<string, unknown> | undefined;
    if (!p) return undefined;
    if (typeof p.icon === "string" || Array.isArray(p.icons)) return p;
    return undefined;
  };

  const findItem = (itemName = name): Record<string, unknown> | undefined => {
    for (const [type, protos] of Object.entries(raw)) {
      const p = protos?.[itemName];
      if (!p || typeof p !== "object" || typeof p.stack_size !== "number") continue;
      const found = tryProto(type, itemName);
      if (found) return found;
    }
    return undefined;
  };

  let source: Record<string, unknown> | undefined;
  if (category === "item") source = findItem();
  else if (category === "entity") {
    source = protoTypeHint ? tryProto(protoTypeHint, name) : undefined;
    if (!source) {
      for (const type of Object.keys(raw)) {
        source = tryProto(type, name);
        if (source) break;
      }
    }
  } else if (category === "recipe") {
    const recipe = raw.recipe?.[name] as Record<string, unknown> | undefined;
    source = tryProto("recipe", name);
    if (!source && recipe) {
      const results = recipe.results as unknown[] | undefined;
      const firstResult = Array.isArray(results) ? results[0] : undefined;
      const product =
        (typeof recipe.main_product === "string" ? recipe.main_product : undefined) ??
        (typeof recipe.result === "string" ? recipe.result : undefined) ??
        (typeof firstResult === "string"
          ? firstResult
          : firstResult && typeof firstResult === "object"
            ? ((firstResult as { name?: unknown }).name as string | undefined)
            : undefined);
      if (product) source = findItem(product) ?? tryProto("fluid", product);
    }
    if (!source) source = findItem();
  } else {
    source = tryProto(category, name);
  }

  if (!source) return undefined;
  type IconLayer = {
    icon: string;
    icon_size?: number;
    scale?: number;
    shift?: [number, number];
    tint?: RawSprite["tint"];
  };
  const rootSize = (source.icon_size as number | undefined) ?? 64;
  const layers: IconLayer[] = Array.isArray(source.icons)
    ? (source.icons as IconLayer[])
    : typeof source.icon === "string"
      ? [{ icon: source.icon, icon_size: rootSize }]
      : [];
  if (layers.length === 0) return undefined;

  const { default: sharp } = await import("sharp");
  const { trimRgba } = await import("../sprite.js");
  const composites: {
    input: Buffer;
    raw: { width: number; height: number; channels: 4 };
    left: number;
    top: number;
  }[] = [];
  for (const layer of layers) {
    if (!layer.icon) continue;
    const size = layer.icon_size ?? rootSize;
    const scale = layer.scale ?? 1;
    const target = Math.max(1, Math.round(64 * scale));
    const rendered = await sharp(resolveSpritePath(layer.icon))
      .extract({ left: 0, top: 0, width: size, height: size })
      .resize(target, target, { fit: "fill", kernel: "nearest" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const tint = normalizeTint(layer.tint);
    if (tint) {
      for (let i = 0; i < rendered.data.length; i += 4) {
        rendered.data[i] = Math.round((rendered.data[i] ?? 0) * tint[0]);
        rendered.data[i + 1] = Math.round((rendered.data[i + 1] ?? 0) * tint[1]);
        rendered.data[i + 2] = Math.round((rendered.data[i + 2] ?? 0) * tint[2]);
        rendered.data[i + 3] = Math.round((rendered.data[i + 3] ?? 0) * tint[3]);
      }
    }
    const shift = layer.shift ?? [0, 0];
    composites.push({
      input: rendered.data,
      raw: { width: target, height: target, channels: 4 },
      left: Math.round((64 - target) / 2 + shift[0]),
      top: Math.round((64 - target) / 2 + shift[1]),
    });
  }
  const composed = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .raw()
    .toBuffer();
  const trimmed = await trimRgba(composed, 64, 64);
  const hash = createHash("sha256").update(trimmed.rgba).digest("hex");
  return bank.add({
    sw: 64,
    sh: 64,
    ox: trimmed.ox,
    oy: trimmed.oy,
    rgba: trimmed.rgba.length ? trimmed.rgba : Buffer.from([0, 0, 0, 0]),
    tw: trimmed.tw || 1,
    th: trimmed.th || 1,
    hash,
  });
}

export interface RawTileMainPicture {
  picture: string;
  count?: number;
  size?: number;
  probability?: number;
  scale?: number;
  x?: number;
  y?: number;
  line_length?: number;
  weights?: number[];
}

/** Stable FNV-1a salt persisted with procedural background definitions. */
function backgroundSeed(name: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function mapColorRgba(
  tile: Record<string, unknown>,
  fallback: [number, number, number, number],
): [number, number, number, number] {
  const color = tile.map_color as number[] | undefined;
  if (!color) return fallback;
  const channel = (index: number, defaultValue: number): number => {
    const value = color[index] ?? defaultValue;
    return round4(value > 1 ? value / 255 : value);
  };
  return [channel(0, 0), channel(1, 0), channel(2, 0), channel(3, 1)];
}

async function distillTerrainPatchSet(
  bank: FrameBank,
  main: RawTileMainPicture,
  name: string,
): Promise<TerrainPatchSet> {
  const patchSize = main.size ?? 1;
  const scale = main.scale ?? 0.5;
  const sourceTilePixels = Math.round(32 / scale);
  const patchPixels = patchSize * sourceTilePixels;
  const sheetX = main.x ?? 0;
  const sheetY = main.y ?? 0;
  const abs = resolveSpritePath(main.picture);
  const dimensions = await imageDimensions(abs);
  const availableColumns = Math.floor((dimensions.width - sheetX) / patchPixels);
  const availableRows = Math.floor((dimensions.height - sheetY) / patchPixels);
  if (availableColumns <= 0 || availableRows <= 0) {
    throw new Error(
      `terrain background ${name} patch ${patchPixels}px lies outside ` +
        `${dimensions.width}x${dimensions.height} sheet`,
    );
  }

  const columns = Math.min(main.line_length ?? availableColumns, availableColumns);
  const authoredCount = main.weights?.length ?? main.count ?? 1;
  const count = Math.min(authoredCount, columns * availableRows);
  const frames: number[] = [];
  for (let index = 0; index < count; index++) {
    const x = sheetX + (index % columns) * patchPixels;
    const y = sheetY + Math.floor(index / columns) * patchPixels;
    frames.push(await bank.add(await cropFileRect(abs, x, y, patchPixels, patchPixels)));
  }

  const weights =
    main.weights && main.weights.length >= count ? main.weights.slice(0, count) : undefined;
  return {
    patchSize,
    frames,
    ...(weights ? { weights } : {}),
    ...(Number.isFinite(main.probability) ? { probability: main.probability } : {}),
  };
}

export async function distillTerrainBackground(
  bank: FrameBank,
  raw: DataRaw,
  name: string,
  fallbackColor: [number, number, number, number],
): Promise<TerrainPatchBackground> {
  const tile = proto(raw, "tile", name);
  const variants = tile.variants as { main?: RawTileMainPicture[] };
  const mainPictures = [...(variants.main ?? [])]
    .filter((candidate) => candidate.picture && (candidate.size ?? 1) > 0)
    .sort((a, b) => (b.size ?? 1) - (a.size ?? 1));
  if (mainPictures.length === 0) {
    throw new Error(`terrain background ${name} has no main picture`);
  }

  const patchSets: TerrainPatchSet[] = [];
  for (const main of mainPictures) {
    patchSets.push(await distillTerrainPatchSet(bank, main, name));
  }
  const largest = patchSets[0]!;
  return {
    seed: backgroundSeed(name),
    ...largest,
    ...(patchSets.length > 1 ? { patches: patchSets.slice(1) } : {}),
    color: mapColorRgba(tile, fallbackColor),
  };
}

/**
 * Distill tiles that use Factorio `material_background` (e.g. fulgoran-dust):
 * square patches of material_texture_*_in_tiles at the sheet scale.
 */
export async function distillMaterialBackground(
  bank: FrameBank,
  raw: DataRaw,
  name: string,
  fallbackColor: [number, number, number, number],
): Promise<TerrainPatchBackground> {
  const tile = proto(raw, "tile", name);
  const variants = tile.variants as {
    material_background?: {
      picture: string;
      count?: number;
      scale?: number;
      line_length?: number;
      x?: number;
      y?: number;
    };
    material_texture_width_in_tiles?: number;
    material_texture_height_in_tiles?: number;
  };
  const mb = variants.material_background;
  if (!mb?.picture) {
    throw new Error(`terrain background ${name} has no material_background`);
  }

  const patchW = variants.material_texture_width_in_tiles ?? 8;
  const patchH = variants.material_texture_height_in_tiles ?? 8;
  if (patchW !== patchH) {
    throw new Error(`terrain background ${name} material patch ${patchW}x${patchH} is not square`);
  }
  const scale = mb.scale ?? 0.5;
  const sourceTilePixels = Math.round(32 / scale);
  const patchPixels = patchW * sourceTilePixels;
  const sheetX = mb.x ?? 0;
  const sheetY = mb.y ?? 0;
  const abs = resolveSpritePath(mb.picture);
  const dimensions = await imageDimensions(abs);
  const availableColumns = Math.floor((dimensions.width - sheetX) / patchPixels);
  const availableRows = Math.floor((dimensions.height - sheetY) / patchPixels);
  if (availableColumns <= 0 || availableRows <= 0) {
    throw new Error(
      `terrain background ${name} material patch ${patchPixels}px lies outside ` +
        `${dimensions.width}x${dimensions.height} sheet`,
    );
  }

  const columns = Math.min(mb.line_length ?? availableColumns, availableColumns);
  const authoredCount = mb.count ?? 1;
  const count = Math.min(authoredCount, columns * availableRows);
  const frames: number[] = [];
  for (let index = 0; index < count; index++) {
    const x = sheetX + (index % columns) * patchPixels;
    const y = sheetY + Math.floor(index / columns) * patchPixels;
    frames.push(await bank.add(await cropFileRect(abs, x, y, patchPixels, patchPixels)));
  }

  return {
    seed: backgroundSeed(name),
    patchSize: patchW,
    frames,
    color: mapColorRgba(tile, fallbackColor),
  };
}

export interface RawWaterEffect {
  textures?: { filename?: string }[];
  specular_lightness?: unknown;
  foam_color?: unknown;
  foam_color_multiplier?: number;
  animation_speed?: number;
  animation_scale?: unknown;
  dark_threshold?: unknown;
  reflection_threshold?: unknown;
  specular_threshold?: unknown;
  near_zoom?: number;
  far_zoom?: number;
}

export function normalizedRgb(
  value: unknown,
  fallback: [number, number, number],
): [number, number, number] {
  const color = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [
          (value as Record<string, unknown>).r,
          (value as Record<string, unknown>).g,
          (value as Record<string, unknown>).b,
        ]
      : fallback;
  const channels = [color[0], color[1], color[2]].map((channel, index) => {
    const fallbackChannel = fallback[index] ?? 0;
    const numeric =
      typeof channel === "number" && Number.isFinite(channel) ? channel : fallbackChannel;
    return numeric > 1 ? numeric / 255 : numeric;
  });
  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
}

export function zoomAdjustedValue(
  value: unknown,
  fallback: number,
  zoom: number,
  nearZoom: number,
  farZoom: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value)) return fallback;
  const near = typeof value[0] === "number" && Number.isFinite(value[0]) ? value[0] : fallback;
  const far = typeof value[1] === "number" && Number.isFinite(value[1]) ? value[1] : near;
  const range = nearZoom - farZoom;
  const amount = range === 0 ? 1 : Math.min(1, Math.max(0, (zoom - farZoom) / range));
  return far + (near - far) * amount;
}

export async function distillWaterBackground(
  bank: FrameBank,
  raw: DataRaw,
): Promise<TerrainPatchBackground> {
  const tile = proto(raw, "tile", "water");
  const variants = tile.variants as { main?: RawTileMainPicture[] };
  const main = [...(variants.main ?? [])]
    .filter((candidate) => candidate.picture && (candidate.size ?? 1) > 0)
    .sort((a, b) => (b.size ?? 1) - (a.size ?? 1))[0];
  if (!main) throw new Error("terrain background water has no main picture");

  const patchSize = main.size ?? 1;
  const scale = main.scale ?? 0.5;
  const sourcePixelsPerTile = Math.round(32 / scale);
  const maskFrameSize = patchSize * sourcePixelsPerTile;
  const maskSheet = await loadImageRgba(resolveSpritePath(main.picture));
  const sheetX = main.x ?? 0;
  const sheetY = main.y ?? 0;
  if (sheetX !== 0 || sheetY !== 0) {
    throw new Error("water mask sheets with source offsets are not supported");
  }
  const availableColumns = Math.floor(maskSheet.width / maskFrameSize);
  const availableRows = Math.floor(maskSheet.height / maskFrameSize);
  const maskFrameCount = availableColumns * availableRows;
  if (availableColumns <= 0 || availableRows !== 1) {
    throw new Error(
      `water mask frame ${maskFrameSize}px does not fit one row of ` +
        `${maskSheet.width}x${maskSheet.height}`,
    );
  }

  const effectName = typeof tile.effect === "string" ? tile.effect : "water";
  const effect = proto(raw, "tile-effect", effectName).water as RawWaterEffect | undefined;
  const noiseFilename = effect?.textures?.[0]?.filename;
  if (!effect || !noiseFilename) throw new Error(`tile effect ${effectName} has no water texture`);
  const noiseTexture = await loadImageRgba(resolveSpritePath(noiseFilename));

  // Factorio interpolates paired water settings between far and near zoom. The editor preview
  // is authored at 1x, so bake the same values at zoom 1 and freeze only the time component.
  const previewZoom = 1;
  const nearZoom = effect.near_zoom ?? 2;
  const farZoom = effect.far_zoom ?? 0.5;
  const effectColor = normalizedRgb(tile.effect_color, [21 / 255, 147 / 255, 167 / 255]);
  const mapColor = normalizedRgb(tile.map_color, [51 / 255, 83 / 255, 95 / 255]);
  // The water shader emits premultiplied translucent pixels. Factorio composites them over its
  // terrain buffer; use the midpoint of the prototype's map and effect colors as that stable base.
  const underwaterColor = mapColor.map(
    (channel, index) => (channel + (effectColor[index] ?? channel)) / 2,
  ) as [number, number, number];
  const foamColor = normalizedRgb(effect.foam_color, [230 / 255, 1, 252 / 255]);
  const foamMultiplier = effect.foam_color_multiplier ?? 2.47;
  const parameters: FrozenWaterParameters = {
    effectColor,
    specularLightness: normalizedRgb(effect.specular_lightness, [1, 1, 1]),
    foamColor: foamColor.map((channel) => channel * foamMultiplier) as [number, number, number],
    darkThreshold: zoomAdjustedValue(effect.dark_threshold, 0.295, previewZoom, nearZoom, farZoom),
    reflectionThreshold: zoomAdjustedValue(
      effect.reflection_threshold,
      0.29,
      previewZoom,
      nearZoom,
      farZoom,
    ),
    specularThreshold: zoomAdjustedValue(
      effect.specular_threshold,
      0.33,
      previewZoom,
      nearZoom,
      farZoom,
    ),
    animationSpeed: effect.animation_speed ?? 0.07,
    animationScale: zoomAdjustedValue(
      effect.animation_scale,
      0.006,
      previewZoom,
      nearZoom,
      farZoom,
    ),
    frozenTime: 0,
  };
  const baked = bakeFrozenWaterSurface({
    maskSheet,
    maskFrameSize,
    maskFrameCount,
    noiseTexture,
    parameters,
    underwaterColor,
    sourcePixelsPerTile,
  });
  const frame = await bank.add({
    sw: baked.width,
    sh: baked.height,
    ox: 0,
    oy: 0,
    rgba: baked.rgba,
    tw: baked.width,
    th: baked.height,
    hash: createHash("sha256").update(baked.rgba).digest("hex"),
  });
  return {
    seed: backgroundSeed("water"),
    patchSize: WATER_SUPERTILE_TILES,
    frames: [frame],
    color: [...underwaterColor, 1],
  };
}

async function optionalTerrainBackground(
  label: string,
  distill: () => Promise<TerrainPatchBackground>,
): Promise<TerrainPatchBackground | undefined> {
  try {
    return await distill();
  } catch (err) {
    // Base-only dumps omit space-age tiles; keep dirt/water and skip the rest.
    console.log(`\n  terrain ${label} SKIP (${err instanceof Error ? err.message : String(err)})`);
    return undefined;
  }
}

export async function distillTerrainBackgrounds(
  bank: FrameBank,
  raw: DataRaw,
): Promise<TerrainBackgrounds> {
  return {
    dirt: await optionalTerrainBackground("dirt", () =>
      distillTerrainBackground(bank, raw, "dirt-1", [141 / 255, 104 / 255, 60 / 255, 1]),
    ),
    water: await optionalTerrainBackground("water", () => distillWaterBackground(bank, raw)),
    vulcanus: await optionalTerrainBackground("vulcanus", () =>
      distillTerrainBackground(bank, raw, "volcanic-soil-dark", [35 / 255, 38 / 255, 30 / 255, 1]),
    ),
    gleba: await optionalTerrainBackground("gleba", () =>
      distillTerrainBackground(bank, raw, "highland-dark-rock", [52 / 255, 55 / 255, 48 / 255, 1]),
    ),
    fulgora: await optionalTerrainBackground("fulgora", () =>
      distillMaterialBackground(bank, raw, "fulgoran-dust", [112 / 255, 65 / 255, 50 / 255, 1]),
    ),
    aquilo: await optionalTerrainBackground("aquilo", () =>
      distillTerrainBackground(bank, raw, "snow-flat", [220 / 255, 230 / 255, 240 / 255, 1]),
    ),
  };
}

/**
 * Distill Factorio starmap planet spheres for the space-platform backdrop.
 * Uses `planet.starmap_icon` (512×512 pre-lit spheres with alpha).
 */
export async function distillSpaceBackground(
  bank: FrameBank,
  raw: DataRaw,
): Promise<SpaceBackground | undefined> {
  const planets: Record<string, number> = {};
  const planetProtos = raw.planet ?? {};
  for (const name of Object.keys(planetProtos).sort()) {
    const planetProto = planetProtos[name] as Record<string, unknown> | undefined;
    if (!planetProto || typeof planetProto.starmap_icon !== "string") continue;
    try {
      const abs = resolveSpritePath(planetProto.starmap_icon);
      planets[name] = await bank.add(await cropEntireFile(abs));
    } catch (err) {
      console.log(
        `  space planet ${name} SKIP (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  const defaultName = planets.nauvis != null ? "nauvis" : Object.keys(planets).sort()[0];
  if (defaultName == null) return undefined;
  return {
    planetFrame: planets[defaultName]!,
    planets,
  };
}

export async function distillTile(
  bank: FrameBank,
  raw: DataRaw,
  name: string,
): Promise<TileRenderDef> {
  const tile = proto(raw, "tile", name);
  const variants = tile.variants as {
    material_background?: {
      picture: string;
      count?: number;
      scale?: number;
      line_length?: number;
      x?: number;
      y?: number;
    };
    main?: RawTileMainPicture[];
    material_texture_width_in_tiles?: number;
    material_texture_height_in_tiles?: number;
  };

  const layer = fpsrLayer("ground-tile", "tile ground; fpsr name ≈ under-tiles");

  if (variants.material_background) {
    const mb = variants.material_background;
    const picture = mb.picture;
    const count = mb.count ?? 1;
    const scale = mb.scale ?? 0.5;
    const patchW = variants.material_texture_width_in_tiles ?? 8;
    const patchH = variants.material_texture_height_in_tiles ?? 8;
    const abs = resolveSpritePath(picture);
    const color = await averageColor(abs);
    const tilePx = Math.round(32 / scale);
    const patchPxW = patchW * tilePx;
    const patchPxH = patchH * tilePx;
    const lineLength = mb.line_length ?? 0;
    const sheetX = mb.x ?? 0;
    const sheetY = mb.y ?? 0;
    const sheetCols = lineLength > 0 ? lineLength : count;
    const sheetRows = lineLength > 0 ? Math.ceil(count / lineLength) : 1;
    const sheetPxW = sheetCols * patchPxW;
    const sheetPxH = sheetRows * patchPxH;
    const sheetCrop = await cropFileRect(abs, sheetX, sheetY, sheetPxW, sheetPxH);
    const sheet = await bank.add(sheetCrop);

    return {
      layer,
      color: mapColorRgba(tile, color),
      material: {
        sheet,
        count,
        patchW,
        patchH,
        tilePx,
        ...(lineLength > 0 ? { lineLength } : {}),
        ...(sheetX !== 0 ? { sheetX } : {}),
        ...(sheetY !== 0 ? { sheetY } : {}),
      },
    };
  }

  // `variants.main` path: only size-1 sheet today. Multi-size 2×2 / 4×4 packing
  // (stone-path) and neighbor transitions are deferred.
  const main0 = variants.main?.[0];
  if (!main0?.picture) throw new Error(`tile ${name} has no material picture`);

  const picture = main0.picture;
  const count = main0.count ?? 1;
  const scale = main0.scale ?? 0.5;
  const abs = resolveSpritePath(picture);
  const color = await averageColor(abs);
  const tilePx = Math.round(32 / scale);
  const frameCount = Math.min(4, Math.max(1, count));
  const frames: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const x = (i * tilePx) % Math.max(tilePx, tilePx * Math.min(count, 16));
    const y = 0;
    const crop = await cropFileRect(abs, x, y, tilePx, tilePx);
    frames.push(await bank.add(crop));
  }

  return {
    layer,
    color: mapColorRgba(tile, color),
    frames,
  };
}

export function discoverItemIconNames(raw: DataRaw): string[] {
  const names = new Set<string>();
  for (const protos of Object.values(raw)) {
    for (const [name, p] of Object.entries(protos ?? {})) {
      if (p && typeof p === "object" && typeof p.stack_size === "number") names.add(name);
    }
  }
  return [...names].sort();
}

export async function directoryBytes(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir);
    let total = 0;
    for (const entry of entries) {
      const info = await stat(path.join(dir, entry));
      if (info.isFile()) total += info.size;
    }
    return total;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function publishAtomic(staging: string, target: string): Promise<void> {
  const backup = `${target}.previous-${process.pid}`;
  let hadTarget = false;
  try {
    await rename(target, backup);
    hadTarget = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, target);
  } catch (error) {
    if (hadTarget) await rename(backup, target);
    throw error;
  }
  if (hadTarget) await rm(backup, { recursive: true, force: true });
}
