import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "@rickyzhangca/fpsr";
import type { Blueprint, BlueprintDocument, BlueprintEntity, RenderDb } from "@rickyzhangca/fpsr";
import type { EntityRenderDef, LayerGroup } from "@rickyzhangca/fpsr/render-db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIXTURE_DB = path.join(REPO_ROOT, "fixtures/render-db/2.1.11.json");
const OUT_DIR = path.join(REPO_ROOT, "fixtures/corpus");

function entityTileSize(def: EntityRenderDef): [number, number] {
  const box = def.selectionBox;
  const w = Math.max(0.5, box[1][0] - box[0][0]);
  const h = Math.max(0.5, box[1][1] - box[0][1]);
  return [w, h];
}

function maxIndexing(def: EntityRenderDef): LayerGroup["indexing"] {
  let best: LayerGroup["indexing"] = "single";
  const rank: Record<LayerGroup["indexing"], number> = {
    single: 0,
    resolver: 1,
    direction4: 2,
    direction8: 3,
    direction16: 4,
  };
  for (const g of def.graphics) {
    if (rank[g.indexing] > rank[best]) best = g.indexing;
  }
  // Belts / UG / loaders / splitters / inserters / gates are 4-way in practice.
  if (
    def.kind === "belt" ||
    def.kind === "underground-belt" ||
    def.kind === "loader" ||
    def.kind === "splitter" ||
    def.kind === "inserter" ||
    def.kind === "gate" ||
    def.kind === "assembler"
  ) {
    return "direction4";
  }
  if (def.kind === "rail") return "direction8";
  if (def.kind === "rail-signal") return "direction16";
  if (def.kind === "train") return "resolver";
  if (best === "resolver") return "direction4";
  return best;
}

function directionsFor(def: EntityRenderDef): number[] {
  const indexing = maxIndexing(def);
  switch (indexing) {
    case "direction16":
      return Array.from({ length: 16 }, (_, i) => i);
    case "direction8":
      return [0, 2, 4, 6, 8, 10, 12, 14];
    case "direction4":
      return [0, 4, 8, 12];
    default:
      return [0];
  }
}

function groupKey(name: string, def: EntityRenderDef): string {
  if (def.kind !== "simple") return def.kind;
  // Split large "simple" bucket by protoType family for readable contact sheets.
  const t = def.protoType;
  if (
    t.includes("turret") ||
    t === "ammo-turret" ||
    t === "electric-turret" ||
    t === "fluid-turret"
  ) {
    return "turret";
  }
  if (
    t === "assembling-machine" ||
    t === "furnace" ||
    t === "rocket-silo" ||
    t === "reactor" ||
    t === "fusion-reactor" ||
    t === "fusion-generator" ||
    t === "thruster" ||
    t === "agricultural-tower" ||
    t === "asteroid-collector" ||
    t === "cargo-bay" ||
    t === "cargo-landing-pad" ||
    t === "space-platform-hub" ||
    t === "mining-drill" ||
    t === "lab" ||
    t === "beacon" ||
    t === "roboport"
  ) {
    return "machine";
  }
  if (
    t.includes("combinator") ||
    t === "power-switch" ||
    t === "programmable-speaker" ||
    t === "display-panel" ||
    t === "lamp" ||
    t === "constant-combinator"
  ) {
    return "circuit";
  }
  if (
    t === "container" ||
    t === "logistic-container" ||
    t === "infinity-container" ||
    t === "linked-container" ||
    t === "proxy-container"
  ) {
    return "chest";
  }
  if (
    t === "electric-pole" ||
    t === "accumulator" ||
    t === "solar-panel" ||
    t === "lightning-attractor"
  ) {
    return "power";
  }
  if (
    t === "boiler" ||
    t === "generator" ||
    t === "pump" ||
    t === "offshore-pump" ||
    t === "storage-tank" ||
    t === "valve" ||
    t === "pipe-to-ground"
  ) {
    return "fluid-machine";
  }
  if (t === "car" || t === "spider-vehicle" || t.includes("robot")) {
    return "vehicle";
  }
  return "simple";
}

function buildEntityBlueprint(
  group: string,
  entries: { name: string; def: EntityRenderDef }[],
): Blueprint {
  const entities: BlueprintEntity[] = [];
  let n = 1;
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  const maxRowW = 64;

  for (const { name, def } of entries) {
    const [tw, th] = entityTileSize(def);
    const gap = 2;
    const dirs = def.kind === "train" ? null : directionsFor(def);
    const poses =
      def.kind === "train"
        ? [{ orientation: 0 }, { orientation: 0.25 }, { orientation: 0.5 }, { orientation: 0.75 }]
        : (dirs ?? [0]).map((d) => ({ direction: d }));

    const cellW = tw + gap;
    const cellH = th + gap;
    const blockW = cellW * poses.length;

    if (cursorX > 0 && cursorX + blockW > maxRowW) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }

    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i];
      if (!pose) continue;
      const x = cursorX + tw / 2 + i * cellW;
      const y = cursorY + th / 2;
      const ent: BlueprintEntity = {
        entity_number: n++,
        name,
        position: { x, y },
      };
      if ("direction" in pose) ent.direction = pose.direction;
      if ("orientation" in pose) ent.orientation = pose.orientation;
      if (def.kind === "underground-belt" || def.kind === "loader") {
        ent.type = i % 2 === 0 ? "input" : "output";
      }
      entities.push(ent);
    }

    cursorX += blockW;
    rowH = Math.max(rowH, cellH);
  }

  return {
    item: "blueprint",
    label: `corpus/${group}`,
    version: 0,
    entities,
  };
}

function buildTilesBlueprint(tileNames: string[]): Blueprint {
  const tiles: NonNullable<Blueprint["tiles"]> = [];
  const cols = Math.ceil(Math.sqrt(tileNames.length));
  tileNames.forEach((name, i) => {
    const x = (i % cols) * 2;
    const y = Math.floor(i / cols) * 2;
    tiles.push({ name, position: { x, y } });
  });
  return {
    item: "blueprint",
    label: "corpus/tiles",
    version: 0,
    tiles,
  };
}

async function main(): Promise<void> {
  const db = JSON.parse(await readFile(FIXTURE_DB, "utf8")) as RenderDb;
  await mkdir(OUT_DIR, { recursive: true });

  const groups = new Map<string, { name: string; def: EntityRenderDef }[]>();
  for (const [name, def] of Object.entries(db.entities)) {
    const g = groupKey(name, def);
    let list = groups.get(g);
    if (!list) {
      list = [];
      groups.set(g, list);
    }
    list.push({ name, def });
  }

  const index: {
    groups: { id: string; file: string; entityCount: number; entities: string[] }[];
    tiles: { file: string; tileCount: number; tiles: string[] };
  } = { groups: [], tiles: { file: "tiles.bp.txt", tileCount: 0, tiles: [] } };

  for (const [g, entries] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const bp = buildEntityBlueprint(g, entries);
    const doc: BlueprintDocument = { blueprint: bp };
    const file = `${g}.bp.txt`;
    await writeFile(path.join(OUT_DIR, file), `${encode(doc)}\n`);
    index.groups.push({
      id: g,
      file,
      entityCount: entries.length,
      entities: entries.map((e) => e.name),
    });
    console.log(`wrote ${file} (${entries.length} entities, ${bp.entities?.length ?? 0} placed)`);
  }

  const tileNames = Object.keys(db.tiles).sort();
  const tilesBp = buildTilesBlueprint(tileNames);
  await writeFile(path.join(OUT_DIR, "tiles.bp.txt"), `${encode({ blueprint: tilesBp })}\n`);
  index.tiles = { file: "tiles.bp.txt", tileCount: tileNames.length, tiles: tileNames };
  console.log(`wrote tiles.bp.txt (${tileNames.length} tiles)`);

  await writeFile(path.join(OUT_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`index: ${index.groups.length} groups + tiles`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
