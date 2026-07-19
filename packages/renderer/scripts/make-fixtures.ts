/**
 * Generate decode fixture .txt files from JSON literals via encode().
 * Run: pnpm -F @rickyzhangca/fpsr fixtures
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "../src/encode.js";
import type { BlueprintDocument } from "../src/types/blueprint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../../../fixtures/decode");

/** Factorio 2.1.11 encoded version: major<<48 | minor<<32 | patch<<16 */
const V = 2 * 2 ** 48 + 1 * 2 ** 32 + 11 * 2 ** 16;

const fixtures: Record<string, BlueprintDocument> = {
  "01-minimal-chest": {
    blueprint: {
      item: "blueprint",
      label: "Minimal chest",
      version: V,
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
      ],
    },
  },

  "02-entities-direction-quality": {
    blueprint: {
      item: "blueprint",
      label: "Direction + quality",
      version: V,
      entities: [
        {
          entity_number: 1,
          name: "inserter",
          position: { x: 1.5, y: 1.5 },
          direction: 4,
          quality: "rare",
        },
        {
          entity_number: 2,
          name: "assembling-machine-2",
          position: { x: 3.5, y: 1.5 },
          recipe: "iron-gear-wheel",
        },
      ],
    },
  },

  "03-tiles-snap-grid": {
    blueprint: {
      item: "blueprint",
      label: "Tiles + snap",
      version: V,
      "snap-to-grid": { x: 0.5, y: 0.5 },
      tiles: [
        { name: "stone-path", position: { x: 0, y: 0 } },
        { name: "stone-path", position: { x: 1, y: 0 } },
        { name: "stone-path", position: { x: 0, y: 1 } },
        { name: "stone-path", position: { x: 1, y: 1 } },
      ],
    },
  },

  "04-wires": {
    blueprint: {
      item: "blueprint",
      label: "Wires",
      version: V,
      entities: [
        {
          entity_number: 1,
          name: "small-electric-pole",
          position: { x: 1.5, y: 1.5 },
        },
        {
          entity_number: 2,
          name: "small-electric-pole",
          position: { x: 5.5, y: 1.5 },
        },
      ],
      wires: [
        [1, 5, 2, 5],
        [1, 1, 2, 1],
      ],
    },
  },

  "05-nested-book": {
    blueprint_book: {
      item: "blueprint-book",
      label: "Main book",
      version: V,
      active_index: 1,
      blueprints: [
        {
          index: 0,
          blueprint: {
            item: "blueprint",
            label: "First",
            version: V,
            entities: [
              {
                entity_number: 1,
                name: "wooden-chest",
                position: { x: 0.5, y: 0.5 },
              },
            ],
          },
        },
        {
          index: 1,
          blueprint: {
            item: "blueprint",
            label: "Second (active)",
            version: V,
            entities: [
              {
                entity_number: 1,
                name: "iron-chest",
                position: { x: 1.5, y: 1.5 },
              },
            ],
          },
        },
        {
          index: 2,
          blueprint_book: {
            item: "blueprint-book",
            label: "Nested book",
            version: V,
            active_index: 0,
            blueprints: [
              {
                index: 0,
                blueprint: {
                  item: "blueprint",
                  label: "Nested blueprint",
                  version: V,
                  entities: [
                    {
                      entity_number: 1,
                      name: "steel-chest",
                      position: { x: 2.5, y: 2.5 },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },

  "06-book-with-planner": {
    blueprint_book: {
      item: "blueprint-book",
      label: "Book with planner",
      version: V,
      active_index: 0,
      blueprints: [
        {
          index: 0,
          blueprint: {
            item: "blueprint",
            label: "Only blueprint",
            version: V,
            entities: [
              {
                entity_number: 1,
                name: "wooden-chest",
                position: { x: 0.5, y: 0.5 },
              },
            ],
          },
        },
        {
          index: 1,
          upgrade_planner: {
            item: "upgrade-planner",
            version: V,
            settings: { target: "wooden-chest", limit: 100 },
          },
        },
      ],
    },
  },
};

// This fixture is a large real-world blueprint and its checked-in decoded JSON
// is the canonical source. Keep its coverage intact while advancing the pinned
// Factorio version alongside the synthetic fixtures above.
const realWorldFixturePath = join(FIXTURES_DIR, "90-real-wiki-example.expected.json");
const realWorldFixture = JSON.parse(
  readFileSync(realWorldFixturePath, "utf8"),
) as BlueprintDocument;
if (!realWorldFixture.blueprint) throw new Error("Real-world fixture is not a blueprint");
realWorldFixture.blueprint.version = V;
fixtures["90-real-wiki-example"] = realWorldFixture;

mkdirSync(FIXTURES_DIR, { recursive: true });

for (const [name, doc] of Object.entries(fixtures)) {
  const txtPath = join(FIXTURES_DIR, `${name}.txt`);
  const jsonPath = join(FIXTURES_DIR, `${name}.expected.json`);

  writeFileSync(txtPath, encode(doc), "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`wrote ${name}`);
}

console.log(`Done — ${Object.keys(fixtures).length} fixtures in ${FIXTURES_DIR}`);
