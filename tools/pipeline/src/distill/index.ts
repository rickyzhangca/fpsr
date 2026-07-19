/**
 * Layer assignment policy (see docs/RENDER_LAYERS.md):
 * - Prefer `officialLayer(...)` / dump fields when Factorio exposes them.
 * - Use `guessedLayer(...)` for engine-hardcoded bodies (not in dump).
 * - Use `fpsrLayer(...)` only for fpsr-invented names (shadow, ground-tile, …).
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { packAtlases } from "../atlas.js";
import {
  discoverPlaceableEntities,
  discoverPlaceableTiles,
  discoverTilePlacingItems,
} from "../discover.js";
import { UNSUPPORTED_ENTITY_PNG, getPipelinePaths } from "../paths.js";
import { guessedLayer } from "../render-layers.js";
import {
  FrameBank,
  clearImageCache,
  cropEntireFile,
  isSprite4Way,
  scaleRegisteredFrames,
} from "../sprite.js";
import type { DataRaw, EntityRenderDef, RawSprite, RenderDb, TileRenderDef } from "../types.js";
import { verifyAssetBundle } from "../verify.js";
import { distillGate, distillRadar, distillTurret, distillVehicle, distillWall } from "./combat.js";
import { entityKindForProtoType, routeEntityPrototype } from "./domains/index.js";
import {
  BELT_ROW_ORDER,
  distillBelt,
  distillCombinatorSprites,
  distillElectricPole,
  distillInserter,
  distillLinkedBelt,
  distillLoader,
  distillPipe,
  distillPowerSwitch,
  distillPump,
  distillRail,
  distillRailRamp,
  distillRailSignal,
  distillRailSupport,
  distillRoboport,
  distillSplitter,
  distillStorageTank,
  distillTrain,
  distillTrainStop,
  distillUndergroundBelt,
} from "./logistics/index.js";
import {
  directoryBytes,
  discoverItemIconNames,
  distillGenericFallback,
  distillIcon,
  distillSpaceBackground,
  distillTerrainBackgrounds,
  distillTile,
  publishAtomic,
} from "./other.js";
import {
  distillAccumulator,
  distillAgriculturalTower,
  distillAssembler,
  distillBeacon,
  distillBoiler,
  distillFusion,
  distillFusionGenerator,
  distillHeatPipe,
  distillLab,
  distillMiningDrill,
  distillOffshorePump,
  distillReactor,
  distillSteamEngine,
} from "./production.js";
import { finalizeEntityDef } from "./shared/finalize.js";
import {
  baseEntity,
  distillDirection4Animation,
  distillGraphicsSetAnimation,
  distillSimplePicture,
  layersFromSprite,
} from "./shared/layers.js";
import { clearPipeCoversCache, withFluidData } from "./shared/pipe.js";
import {
  distillAsteroidCollector,
  distillGraphicsSetPictureArray,
  distillRocketSilo,
  distillThruster,
} from "./space.js";

export { BELT_ROW_ORDER };

async function distillEntity(
  bank: FrameBank,
  name: string,
  protoType: string,
  p: Record<string, unknown>,
  placeholders: { name: string; reason: string }[],
): Promise<EntityRenderDef> {
  const kind = entityKindForProtoType(protoType);
  const { strategy } = routeEntityPrototype(protoType);
  let def: EntityRenderDef;

  try {
    switch (strategy) {
      case "simple-picture":
        def = await distillSimplePicture(bank, p, protoType);
        break;
      case "logistic-container": {
        if (p.picture) {
          def = await distillSimplePicture(bank, p, protoType);
        } else {
          const door = p.robot_door as { animation?: RawSprite } | undefined;
          const graphics = await layersFromSprite(bank, door?.animation, {
            layer: guessedLayer("object", "entity body; dump has no render_layer"),
            indexing: "single",
            frame: 0,
          });
          def = baseEntity("simple", protoType, p, graphics);
        }
        break;
      }
      case "assembler": {
        def = await distillAssembler(bank, p, protoType);
        break;
      }
      case "furnace": {
        const gs = p.graphics_set as
          | {
              animation?: RawSprite;
              idle_animation?: RawSprite;
            }
          | undefined;
        const anim = gs?.animation ?? gs?.idle_animation;
        if (anim && isSprite4Way(anim)) {
          def = await distillDirection4Animation(bank, p, protoType, "simple");
        } else {
          def = await distillGraphicsSetAnimation(bank, p, protoType, "simple");
        }
        break;
      }
      case "inserter":
        def = await distillInserter(bank, p);
        break;
      case "electric-pole":
        def = await distillElectricPole(bank, p);
        break;
      case "accumulator":
        def = await distillAccumulator(bank, p);
        // distillAccumulator hardcodes protoType "accumulator"
        def = { ...def, protoType };
        break;
      case "lab":
        def = await distillLab(bank, p);
        def = { ...def, protoType };
        break;
      case "radar":
        def = await distillRadar(bank, p);
        break;
      case "beacon":
        def = await distillBeacon(bank, p);
        break;
      case "mining-drill":
        def = await distillMiningDrill(bank, p, protoType);
        break;
      case "pipe-to-ground": {
        const pictures = p.pictures as RawSprite;
        const graphics = await layersFromSprite(bank, pictures, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "direction4",
        });
        def = withFluidData(baseEntity("simple", protoType, p, graphics), p);
        break;
      }
      case "pipe":
        def = await distillPipe(bank, p);
        break;
      case "infinity-pipe": {
        // Same picture keys as pipe.
        def = await distillPipe(bank, p);
        def = { ...def, protoType };
        break;
      }
      case "heat-pipe":
        def = await distillHeatPipe(bank, p);
        break;
      case "wall":
        def = await distillWall(bank, p);
        break;
      case "gate":
        def = await distillGate(bank, p);
        break;
      case "boiler":
        def = await distillBoiler(bank, p, protoType);
        break;
      case "storage-tank":
        def = await distillStorageTank(bank, p);
        break;
      case "pump":
        def = await distillPump(bank, p);
        def = { ...def, protoType };
        break;
      case "offshore-pump":
        def = await distillOffshorePump(bank, p);
        break;
      case "steam-engine":
        def = await distillSteamEngine(bank, p, protoType);
        break;
      case "reactor":
        def = await distillReactor(bank, p);
        def = { ...def, protoType };
        break;
      case "belt":
        def = await distillBelt(bank, p, protoType);
        break;
      case "underground-belt":
        def = await distillUndergroundBelt(bank, p, protoType);
        break;
      case "loader":
        def = await distillLoader(bank, p, protoType);
        break;
      case "linked-belt":
        def = await distillLinkedBelt(bank, p);
        break;
      case "splitter":
        def = await distillSplitter(bank, p, protoType);
        break;
      case "rail-ground":
        def = await distillRail(bank, p, protoType, false);
        break;
      case "rail-elevated":
        def = await distillRail(bank, p, protoType, true);
        break;
      case "rail-ramp":
        def = await distillRailRamp(bank, p);
        break;
      case "rail-support":
        def = await distillRailSupport(bank, p);
        break;
      case "rail-signal":
        def = await distillRailSignal(bank, p, protoType);
        break;
      case "train":
        def = await distillTrain(bank, p, protoType);
        break;
      case "combinator":
        def = await distillCombinatorSprites(bank, p, protoType);
        break;
      case "power-switch":
        def = await distillPowerSwitch(bank, p);
        break;
      case "roboport":
        def = await distillRoboport(bank, p);
        break;
      case "rocket-silo":
        def = await distillRocketSilo(bank, p);
        break;
      case "train-stop":
        def = await distillTrainStop(bank, p);
        break;
      case "turret":
        def = await distillTurret(bank, p, protoType);
        break;
      case "space-structure":
        def = await distillGraphicsSetPictureArray(bank, p, protoType);
        break;
      case "fusion-reactor":
        def = await distillFusion(bank, p, protoType);
        break;
      case "fusion-generator":
        def = await distillFusionGenerator(bank, p);
        break;
      case "thruster":
        def = await distillThruster(bank, p);
        break;
      case "asteroid-collector":
        def = await distillAsteroidCollector(bank, p);
        break;
      case "agricultural-tower":
        def = await distillAgriculturalTower(bank, p, protoType);
        break;
      case "lamp":
        def = await layersFromSprite(bank, p.picture_off as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "land-mine":
        def = await layersFromSprite(bank, p.picture_safe as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "speaker":
        def = await layersFromSprite(bank, p.sprite as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "vehicle":
        def = await distillVehicle(bank, p, protoType);
        break;
      case "spider-vehicle":
        def = await layersFromSprite(
          bank,
          (p.animation ??
            (p.graphics_set as { animation?: RawSprite } | undefined)?.animation) as RawSprite,
          {
            layer: guessedLayer("object", "entity body; dump has no render_layer"),
            indexing: "single",
            frame: 0,
          },
        ).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "robot":
        def = await layersFromSprite(bank, p.idle as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
          frame: 0,
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "generic":
        def = await distillGenericFallback(bank, p, protoType, kind);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    def = baseEntity(kind, protoType, p, []);
    return finalizeEntityDef(bank, p, def, placeholders, name, `distill error: ${msg}`);
  }

  // Ensure kind matches heuristic (some helpers hardcode kind).
  if (def.kind !== kind && kind !== "simple") {
    // Keep specialized kinds from helpers (e.g. pipe/belt); only override when
    // heuristic is more specific than simple default from a helper.
    if (def.kind === "simple" || def.protoType !== protoType) {
      def = { ...def, kind, protoType };
    }
  } else {
    def = { ...def, protoType };
  }

  return finalizeEntityDef(bank, p, def, placeholders, name, "no usable graphics resolved");
}

export interface DistillReport {
  placeholders: { name: string; reason: string }[];
  entityCount: number;
  tileCount: number;
  kindCounts: Record<string, number>;
  packing?: {
    sourceFrames: number;
    packedFrames: number;
    sourcePixels: number;
    packedPixels: number;
    clonedPixelRatio: number;
  };
  tierPacking?: Record<
    "1x" | "2x",
    {
      frames: number;
      atlases: number;
      decodedPixels: number;
      blobBytes: number;
    }
  >;
}

const MAX_BUNDLE_GROWTH_RATIO = 1.5;

export interface DistillAndPackOptions {
  /** Skip the bundle-size guard (e.g. after intentional tile-material growth). */
  allowBundleGrowth?: boolean;
}

export async function distillAndPack(options: DistillAndPackOptions = {}): Promise<RenderDb> {
  const paths = getPipelinePaths();
  clearPipeCoversCache();
  clearImageCache();
  console.log("distill: loading data-raw-dump.json…");
  const text = await readFile(paths.dumpPath, "utf8");
  const raw = JSON.parse(text) as DataRaw;
  console.log(`distill: parsed ${(text.length / 1e6).toFixed(1)} MB`);

  const bank = new FrameBank();
  const entities: Record<string, EntityRenderDef> = {};
  const placeholders: { name: string; reason: string }[] = [];
  const placeable = discoverPlaceableEntities(raw);
  console.log(`distill: discovered ${placeable.length} placeable entities`);

  for (const { name, type, proto: p } of placeable) {
    process.stdout.write(`  entity ${name} [${type}]…`);
    const def = await distillEntity(bank, name, type, p, placeholders);
    entities[name] = def;
    const ph = placeholders.find((x) => x.name === name);
    console.log(
      ph ? ` PLACEHOLDER (${ph.reason})` : ` ok (${def.kind}, ${def.graphics.length} layer groups)`,
    );
  }

  const tileNames = discoverPlaceableTiles(raw);
  const tilePlacingItems = discoverTilePlacingItems(raw);
  const tiles: Record<string, TileRenderDef> = {};
  const icons: Record<string, number> = {};
  for (const name of tileNames) {
    process.stdout.write(`  tile ${name}…`);
    try {
      const def = await distillTile(bank, raw, name);
      const placingItem = tilePlacingItems[name];
      if (placingItem) def.item = placingItem;
      tiles[name] = def;
      if (def.icon != null) icons[`tile/${name}`] = def.icon;
      console.log(" ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` SKIP (${msg})`);
    }
  }

  process.stdout.write("  terrain backgrounds…");
  const terrainBackgrounds = await distillTerrainBackgrounds(bank, raw);
  const terrainSummary = Object.entries(terrainBackgrounds)
    .map(([name, background]) => {
      const count = [background, ...(background?.patches ?? [])].reduce(
        (total, patch) => total + (patch?.frames.length ?? 0),
        0,
      );
      return `${name} ${count}`;
    })
    .join(", ");
  console.log(` ok (${terrainSummary})`);

  process.stdout.write("  space background…");
  const spaceBackground = await distillSpaceBackground(bank, raw);
  console.log(
    spaceBackground
      ? ` ok (starmap planets, ${Object.keys(spaceBackground.planets ?? {}).length} planets)`
      : " SKIP (no starmap planets)",
  );

  const iconScales: Record<string, number> = {};
  const iconJobs: {
    key: string;
    cat:
      | "item"
      | "recipe"
      | "fluid"
      | "virtual-signal"
      | "quality"
      | "entity"
      | "space-location"
      | "asteroid-chunk";
    name: string;
    type?: string;
  }[] = [];

  for (const { name, type } of placeable) {
    iconJobs.push({ key: `entity/${name}`, cat: "entity", name, type });
    iconJobs.push({ key: `item/${name}`, cat: "item", name });
  }
  // Deconstruction planner trees/rocks-only thumbnail (trees are not placeable).
  iconJobs.push({ key: "entity/tree-01", cat: "entity", name: "tree-01", type: "tree" });
  for (const name of Object.keys(raw.recipe ?? {}).sort()) {
    iconJobs.push({ key: `recipe/${name}`, cat: "recipe", name });
  }
  for (const name of discoverItemIconNames(raw)) {
    iconJobs.push({ key: `item/${name}`, cat: "item", name });
  }
  for (const category of [
    "fluid",
    "virtual-signal",
    "quality",
    "space-location",
    "asteroid-chunk",
  ] as const) {
    for (const name of Object.keys(raw[category] ?? {}).sort()) {
      iconJobs.push({ key: `${category}/${name}`, cat: category, name });
    }
  }

  const utility = raw["utility-sprites"]?.default as Record<string, RawSprite> | undefined;
  for (const [key, field] of [
    ["utility/entity-info-dark-background", "entity_info_dark_background"],
    ["utility/missing-icon", "missing_icon"],
    ["utility/filter-blacklist", "filter_blacklist"],
    ["utility/indication-arrow", "indication_arrow"],
  ] as const) {
    const sprite = utility?.[field];
    if (!sprite) continue;
    try {
      icons[key] = (await bank.addSprite(sprite)).frameId;
      if (typeof sprite.scale === "number" && Number.isFinite(sprite.scale)) {
        iconScales[key] = sprite.scale;
      }
    } catch (err) {
      console.log(`  icon ${key} MISSING (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Blueprint snap-to-grid cursor box (`utility-sprites.cursor_box.blueprint_snap_rectangle`).
  // Full 1×1 box from cursor-boxes-32x32; L-corners from cursor-boxes.png (size tiers).
  for (const [key, sprite] of [
    [
      "utility/blueprint-snap-full",
      {
        filename: "__core__/graphics/cursor-boxes-32x32.png",
        width: 64,
        height: 64,
        x: 320,
        y: 0,
        scale: 0.5,
      },
    ],
    [
      "utility/blueprint-snap-corner-sm",
      {
        filename: "__core__/graphics/cursor-boxes.png",
        width: 64,
        height: 64,
        x: 64,
        y: 324,
        scale: 0.5,
      },
    ],
    [
      "utility/blueprint-snap-corner-lg",
      {
        filename: "__core__/graphics/cursor-boxes.png",
        width: 64,
        height: 64,
        x: 0,
        y: 324,
        scale: 0.5,
      },
    ],
  ] as const) {
    try {
      icons[key] = (await bank.addSprite(sprite)).frameId;
      iconScales[key] = sprite.scale;
      console.log(`  icon ${key} ok`);
    } catch (err) {
      console.log(`  icon ${key} MISSING (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Item-request pin chrome (modules/fuel to insert). Not in utility-sprites; it is
  // the item-request-proxy icon mip sheet — crop the first 64×64 mip only.
  try {
    icons["utility/item-request-slot"] = (
      await bank.addSprite({
        filename: "__core__/graphics/icons/mip/item-request-slot.png",
        size: 64,
      })
    ).frameId;
    console.log("  icon utility/item-request-slot ok");
  } catch (err) {
    console.log(
      `  icon utility/item-request-slot MISSING (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  try {
    const crop = await cropEntireFile(UNSUPPORTED_ENTITY_PNG);
    icons["utility/unsupported-entity"] = await bank.add(crop);
    console.log("  icon utility/unsupported-entity ok (fpsr asset)");
  } catch (err) {
    console.log(
      `  icon utility/unsupported-entity MISSING (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  for (const job of iconJobs) {
    if (icons[job.key] != null) continue;
    process.stdout.write(`  icon ${job.key}…`);
    const id = await distillIcon(bank, raw, job.cat, job.name, job.type);
    if (id != null) {
      icons[job.key] = id;
      if (job.cat === "entity") {
        const ent = entities[job.name];
        if (ent) ent.icon = id;
      }
      console.log(" ok");
    } else {
      console.log(" MISSING");
    }
  }

  await mkdir(paths.assetsOut, { recursive: true });
  const staging = await mkdtemp(path.join(paths.assetsOut, `.tmp-${paths.install.version}-`));
  console.log("pack: deriving 1x frames…");
  const oneXFrames = await scaleRegisteredFrames(bank.list(), 0.5);
  const tierDefinitions = () => ({
    entities: structuredClone(entities),
    tiles: structuredClone(tiles),
    terrainBackgrounds: structuredClone(terrainBackgrounds),
    ...(spaceBackground ? { spaceBackground: structuredClone(spaceBackground) } : {}),
    icons: structuredClone(icons),
  });

  console.log("pack: packing 1x atlases…");
  const oneXDefinitions = tierDefinitions();
  const packed1x = await packAtlases(oneXFrames, oneXDefinitions, staging, {
    format: "webp",
  }).catch(async (error) => {
    await rm(staging, { recursive: true, force: true });
    throw error;
  });

  console.log("pack: packing 2x atlases…");
  const twoXDefinitions = tierDefinitions();
  const packed2x = await packAtlases(bank.list(), twoXDefinitions, staging, {
    format: "webp",
  }).catch(async (error) => {
    await rm(staging, { recursive: true, force: true });
    throw error;
  });

  const persistTier = async (
    density: 1 | 2,
    packed: typeof packed2x,
    definitions: ReturnType<typeof tierDefinitions>,
  ) => {
    const db: RenderDb = {
      schema: 2,
      gameVersion: paths.install.version,
      mods: [...paths.mods],
      assetDensity: density,
      atlases: packed.atlases,
      frames: packed.frames,
      ...definitions,
      ...(Object.keys(iconScales).length > 0 ? { iconScales } : {}),
    };
    const dbJson = `${JSON.stringify(db)}\n`;
    const sha256 = createHash("sha256").update(dbJson).digest("hex");
    const file = `render-db.${sha256}.json`;
    await writeFile(path.join(staging, file), dbJson);
    return {
      db,
      manifest: {
        density,
        renderDb: { file, sha256, bytes: Buffer.byteLength(dbJson) },
        atlases: packed.manifestAtlases.map((atlas) => ({
          file: atlas.file,
          w: atlas.width,
          h: atlas.height,
          sha256: atlas.sha256,
          bytes: atlas.bytes,
        })),
      },
    };
  };

  const oneX = await persistTier(1, packed1x, oneXDefinitions);
  const twoX = await persistTier(2, packed2x, twoXDefinitions);

  const fontsDir = path.join(staging, "fonts");
  await mkdir(fontsDir, { recursive: true });
  const dejavuSrc = path.join(paths.install.data, "core/fonts/DejaVuSans.ttf");
  const dejavuLicenseSrc = path.join(paths.install.data, "core/fonts/license - DejaVuSans.txt");
  const dejavuFile = "fonts/DejaVuSans.ttf";
  const dejavuLicenseFile = "fonts/license-DejaVuSans.txt";
  await copyFile(dejavuSrc, path.join(staging, dejavuFile));
  await copyFile(dejavuLicenseSrc, path.join(staging, dejavuLicenseFile));
  const dejavuBytes = await readFile(path.join(staging, dejavuFile));
  const dejavuSha = createHash("sha256").update(dejavuBytes).digest("hex");

  const manifest = {
    schema: 2,
    gameVersion: paths.install.version,
    mods: [...paths.mods],
    tiers: { "1x": oneX.manifest, "2x": twoX.manifest },
    fonts: [
      {
        file: dejavuFile,
        family: "fpsr-dejavu",
        sha256: dejavuSha,
        bytes: dejavuBytes.byteLength,
      },
    ],
  };
  await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const kindCounts: Record<string, number> = {};
  for (const e of Object.values(entities)) {
    kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
  }
  const report: DistillReport = {
    placeholders,
    entityCount: Object.keys(entities).length,
    tileCount: Object.keys(tiles).length,
    kindCounts,
    packing: {
      sourceFrames: packed2x.stats.sourceFrames,
      packedFrames: packed2x.stats.packedFrames,
      sourcePixels: packed2x.stats.sourcePixels,
      packedPixels: packed2x.stats.packedPixels,
      clonedPixelRatio: packed2x.stats.clonedPixelRatio,
    },
    tierPacking: {
      "1x": {
        frames: packed1x.frames.length,
        atlases: packed1x.atlases.length,
        decodedPixels: packed1x.atlases.reduce((sum, atlas) => sum + atlas.width * atlas.height, 0),
        blobBytes: packed1x.manifestAtlases.reduce((sum, atlas) => sum + atlas.bytes, 0),
      },
      "2x": {
        frames: packed2x.frames.length,
        atlases: packed2x.atlases.length,
        decodedPixels: packed2x.atlases.reduce((sum, atlas) => sum + atlas.width * atlas.height, 0),
        blobBytes: packed2x.manifestAtlases.reduce((sum, atlas) => sum + atlas.bytes, 0),
      },
    },
  };
  await writeFile(
    path.join(staging, "distill-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  clearImageCache();

  const previousBytes = await directoryBytes(paths.versionOut);
  const generatedBytes = await directoryBytes(staging);
  if (
    !options.allowBundleGrowth &&
    previousBytes > 0 &&
    generatedBytes > previousBytes * MAX_BUNDLE_GROWTH_RATIO
  ) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(
      `Generated bundle ${(generatedBytes / 1024 / 1024).toFixed(2)} MiB exceeds ` +
        `${(MAX_BUNDLE_GROWTH_RATIO * 100).toFixed(0)}% of existing ` +
        `${(previousBytes / 1024 / 1024).toFixed(2)} MiB bundle. ` +
        `Re-run with --allow-bundle-growth if the increase is expected.`,
    );
  }
  await verifyAssetBundle(staging).catch(async (error) => {
    await rm(staging, { recursive: true, force: true });
    throw error;
  });
  await publishAtomic(staging, paths.versionOut);

  console.log(
    `distill: done — ${report.entityCount} entities, ${report.tileCount} tiles, ${Object.keys(icons).length} icons, ` +
      `1x ${packed1x.frames.length} frames/${packed1x.atlases.length} atlases, ` +
      `2x ${packed2x.frames.length} frames/${packed2x.atlases.length} atlases`,
  );
  if (placeholders.length > 0) {
    console.log(`distill: ${placeholders.length} placeholders:`);
    for (const ph of placeholders) console.log(`  - ${ph.name}: ${ph.reason}`);
  }
  console.log(`  kinds: ${JSON.stringify(kindCounts)}`);
  console.log(
    `  render DBs: 1x ${(oneX.manifest.renderDb.bytes / 1024).toFixed(1)} KB, ` +
      `2x ${(twoX.manifest.renderDb.bytes / 1024).toFixed(1)} KB`,
  );
  return twoX.db;
}
