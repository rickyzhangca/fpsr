/**
 * Generate belt-ring and pipe-plant blueprint strings for the golden corpus.
 * Run: pnpm -F @fpsr/golden-tests seed
 */
import type { BlueprintDocument, BlueprintEntity } from "fpsr";
import { encode } from "fpsr";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");
const GOLDEN_DIR = join(REPO_ROOT, "fixtures/golden");
const DECODE_FIXTURE = join(REPO_ROOT, "fixtures/decode/90-real-wiki-example.txt");

/** Factorio 2.1.9 encoded version: major<<48 | minor<<32 | patch<<16 */
const V = 2 * 2 ** 48 + 1 * 2 ** 32 + 9 * 2 ** 16;

function beltRingEntities(): BlueprintEntity[] {
  const belts: { x: number; y: number; direction: number }[] = [
    // Top row (east), corners face outgoing direction
    { x: 0.5, y: 0.5, direction: 4 },
    { x: 1.5, y: 0.5, direction: 4 },
    { x: 2.5, y: 0.5, direction: 4 },
    { x: 3.5, y: 0.5, direction: 8 },
    // Right column (south)
    { x: 3.5, y: 1.5, direction: 8 },
    { x: 3.5, y: 2.5, direction: 8 },
    // Bottom row (west)
    { x: 3.5, y: 3.5, direction: 12 },
    { x: 2.5, y: 3.5, direction: 12 },
    { x: 1.5, y: 3.5, direction: 12 },
    { x: 0.5, y: 3.5, direction: 0 },
    // Left column (north)
    { x: 0.5, y: 2.5, direction: 0 },
    { x: 0.5, y: 1.5, direction: 0 },
  ];

  return belts.map((belt, i) => ({
    entity_number: i + 1,
    name: "transport-belt",
    position: { x: belt.x, y: belt.y },
    direction: belt.direction,
  }));
}

function pipePlantEntities(): BlueprintEntity[] {
  return [
    { entity_number: 1, name: "boiler", position: { x: 0.5, y: 0 }, direction: 0 },
    { entity_number: 2, name: "pipe", position: { x: -1.5, y: 0.5 } },
    { entity_number: 3, name: "pipe", position: { x: 0.5, y: -1.5 } },
    { entity_number: 4, name: "pipe", position: { x: 0.5, y: -2.5 } },
    { entity_number: 5, name: "pipe", position: { x: 0.5, y: -3.5 } },
    { entity_number: 6, name: "pipe", position: { x: -0.5, y: -2.5 } },
    { entity_number: 7, name: "pipe", position: { x: 1.5, y: -2.5 } },
    { entity_number: 8, name: "pipe", position: { x: 0.5, y: -4.5 } },
    { entity_number: 9, name: "pump", position: { x: 0.5, y: -6 }, direction: 0 },
    { entity_number: 10, name: "pipe", position: { x: 0.5, y: -7.5 } },
    // Shifted west so SE south port ([1,2]) lands on the pipe at (0.5,-7.5).
    // Unconnected tank N/E/W + boiler E exercise pipe_covers in all 4 dirs.
    { entity_number: 11, name: "storage-tank", position: { x: -0.5, y: -9.5 }, direction: 0 },
  ];
}

function blueprintDoc(label: string, entities: BlueprintEntity[]): BlueprintDocument {
  return {
    blueprint: {
      item: "blueprint",
      label,
      version: V,
      entities,
    },
  };
}

mkdirSync(GOLDEN_DIR, { recursive: true });

copyFileSync(DECODE_FIXTURE, join(GOLDEN_DIR, "smoke.bp.txt"));

writeFileSync(
  join(GOLDEN_DIR, "belt-ring.bp.txt"),
  encode(blueprintDoc("Belt ring", beltRingEntities())),
  "utf8",
);
writeFileSync(
  join(GOLDEN_DIR, "pipe-plant.bp.txt"),
  encode(blueprintDoc("Pipe plant", pipePlantEntities())),
  "utf8",
);

console.log("Seeded golden blueprint fixtures in fixtures/golden/");
