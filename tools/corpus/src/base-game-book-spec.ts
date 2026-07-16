export const BASE_GAME_VERSION = "2.1.11";

import {
  entityNamesInBook,
  pageInBook,
  pagesInBook,
  rootBookIn,
  tileNamesInBook,
  type BookEntrySpec,
  type BookSpec,
  type FactorioModBookSpec,
  type PageSpec,
} from "./mod-book-spec.js";

export type BaseGameBookSpec = BookSpec;
export type BaseGamePageSpec = PageSpec;
export type BaseGameBookEntrySpec = BookEntrySpec;

/**
 * The Base visual-test book as it appears in the Viewer.
 *
 * This is the single ownership point for both presentation and inventory:
 * the suite generator walks this tree to build the nested blueprint book, and
 * the flattened entity/tile lists below are derived from its leaf pages.
 * Other official mods own separate specs; profile-level books compose those
 * specs instead of merging their inventories into this Base definition.
 */
export const BASE_GAME_BOOK_SPEC = {
  kind: "book",
  mod: "base",
  gameVersion: BASE_GAME_VERSION,
  id: "base-game-2.1.11",
  label: `base items ${BASE_GAME_VERSION}`,
  icons: ["assembling-machine-3", "transport-belt", "rail", "concrete"],
  children: [
    {
      kind: "book",
      id: "logistics",
      label: "logistics",
      icons: ["transport-belt", "inserter"],
      children: [
        {
          kind: "page",
          id: "entity-poses/logistics/storage",
          label: "storage",
          icons: ["wooden-chest"],
          entities: ["wooden-chest", "iron-chest", "steel-chest", "storage-tank"],
        },
        {
          kind: "book",
          id: "belt-transport-system",
          label: "belt transport system",
          icons: ["transport-belt", "underground-belt", "splitter"],
          children: [
            {
              kind: "page",
              id: "entity-poses/logistics/belt-transport-system/belts",
              label: "belts",
              icons: ["transport-belt"],
              entities: ["transport-belt", "fast-transport-belt", "express-transport-belt"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/belt-transport-system/underground-belts",
              label: "underground belts",
              icons: ["underground-belt"],
              entities: ["underground-belt", "fast-underground-belt", "express-underground-belt"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/belt-transport-system/splitters",
              label: "splitters",
              icons: ["splitter"],
              entities: ["splitter", "fast-splitter", "express-splitter"],
            },
          ],
        },
        {
          kind: "page",
          id: "entity-poses/logistics/inserters",
          label: "inserters",
          icons: ["inserter"],
          entities: [
            "burner-inserter",
            "inserter",
            "long-handed-inserter",
            "fast-inserter",
            "bulk-inserter",
          ],
        },
        {
          kind: "page",
          id: "entity-poses/logistics/electric-fluid-system",
          label: "electric & fluid system",
          icons: ["small-electric-pole", "pipe"],
          entities: [
            "small-electric-pole",
            "medium-electric-pole",
            "big-electric-pole",
            "substation",
            "pipe",
            "pipe-to-ground",
            "pump",
          ],
        },
        {
          kind: "book",
          id: "railway",
          label: "railway",
          icons: ["rail", "rail-signal", "locomotive"],
          children: [
            {
              kind: "page",
              id: "entity-poses/logistics/railway/rails",
              label: "rails",
              icons: ["rail"],
              entities: ["straight-rail", "curved-rail-a", "curved-rail-b", "half-diagonal-rail"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/railway/train-stop",
              label: "train stop",
              icons: ["train-stop"],
              entities: ["train-stop"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/railway/rail-signals",
              label: "rail signals",
              icons: ["rail-signal", "rail-chain-signal"],
              entities: ["rail-signal", "rail-chain-signal"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/railway/locomotive",
              label: "locomotive",
              icons: ["locomotive"],
              entities: ["locomotive"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/railway/cargo-wagon",
              label: "cargo wagon",
              icons: ["cargo-wagon"],
              entities: ["cargo-wagon"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/railway/fluid-wagon",
              label: "fluid wagon",
              icons: ["fluid-wagon"],
              entities: ["fluid-wagon"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/railway/artillery-wagon",
              label: "artillery wagon",
              icons: ["artillery-wagon"],
              entities: ["artillery-wagon"],
            },
          ],
        },
        {
          kind: "book",
          id: "transport",
          label: "transport",
          icons: ["car", "tank", "spidertron"],
          children: [
            {
              kind: "page",
              id: "entity-poses/logistics/transport/car",
              label: "car",
              icons: ["car"],
              entities: ["car"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/transport/tank",
              label: "tank",
              icons: ["tank"],
              entities: ["tank"],
            },
            {
              kind: "page",
              id: "entity-poses/logistics/transport/spidertron",
              label: "spidertron",
              icons: ["spidertron"],
              entities: ["spidertron"],
            },
          ],
        },
        {
          kind: "page",
          id: "entity-poses/logistics/logistic-network",
          label: "logistic network",
          icons: ["logistic-robot", "construction-robot", "passive-provider-chest", "roboport"],
          entities: [
            "passive-provider-chest",
            "active-provider-chest",
            "storage-chest",
            "buffer-chest",
            "requester-chest",
            "logistic-robot",
            "construction-robot",
            "roboport",
          ],
        },
        {
          kind: "page",
          id: "entity-poses/logistics/circuit-network",
          label: "circuit network",
          icons: ["small-lamp", "arithmetic-combinator", "decider-combinator", "display-panel"],
          entities: [
            "small-lamp",
            "arithmetic-combinator",
            "decider-combinator",
            "selector-combinator",
            "constant-combinator",
            "power-switch",
            "programmable-speaker",
            "display-panel",
          ],
        },
        {
          kind: "page",
          id: "entity-poses/logistics/terrain",
          label: "terrain",
          icons: ["stone-brick", "concrete", "landfill"],
          tiles: [
            "stone-path",
            "concrete",
            "hazard-concrete-left",
            "hazard-concrete-right",
            "refined-concrete",
            "refined-hazard-concrete-left",
            "refined-hazard-concrete-right",
            "landfill",
          ],
        },
      ],
    },
    {
      kind: "book",
      id: "production",
      label: "production items",
      icons: ["assembling-machine-3", "rocket-silo"],
      children: [
        {
          kind: "page",
          id: "entity-poses/production/electricity",
          label: "electricity",
          icons: ["steam-engine"],
          entities: [
            "boiler",
            "steam-engine",
            "solar-panel",
            "accumulator",
            "nuclear-reactor",
            "heat-pipe",
            "heat-exchanger",
            "steam-turbine",
          ],
        },
        {
          kind: "page",
          id: "entity-poses/production/resource-extraction",
          label: "resource extraction",
          icons: ["burner-mining-drill"],
          entities: ["burner-mining-drill", "electric-mining-drill", "offshore-pump", "pumpjack"],
        },
        {
          kind: "page",
          id: "entity-poses/production/furnaces",
          label: "furnaces",
          icons: ["stone-furnace"],
          entities: ["stone-furnace", "steel-furnace", "electric-furnace"],
        },
        {
          kind: "page",
          id: "entity-poses/production/production",
          label: "production",
          icons: ["assembling-machine-3"],
          entities: [
            "assembling-machine-1",
            "assembling-machine-2",
            "assembling-machine-3",
            "oil-refinery",
            "chemical-plant",
            "centrifuge",
            "lab",
          ],
        },
        {
          kind: "page",
          id: "entity-poses/production/modules",
          label: "modules",
          icons: ["beacon"],
          entities: ["beacon"],
        },
      ],
    },
    {
      kind: "book",
      id: "space",
      label: "space",
      icons: ["rocket-silo"],
      children: [
        {
          kind: "page",
          id: "space/planetside",
          label: "planetside",
          icons: ["rocket-silo"],
          entities: ["rocket-silo", "cargo-landing-pad"],
        },
      ],
    },
    {
      kind: "book",
      id: "combat-items",
      label: "combat items",
      icons: ["stone-wall", "gun-turret"],
      children: [
        {
          kind: "page",
          id: "combat-items/defense",
          label: "defense",
          icons: ["stone-wall"],
          entities: ["stone-wall", "gate", "radar", "land-mine"],
        },
        {
          kind: "page",
          id: "combat-items/turrets",
          label: "turrets",
          icons: ["gun-turret"],
          entities: ["gun-turret", "laser-turret", "flamethrower-turret", "artillery-turret"],
        },
      ],
    },
    {
      kind: "book",
      id: "internal-legacy",
      label: "internal & legacy",
      icons: ["loader", "infinity-chest"],
      children: [
        {
          kind: "page",
          id: "internal-legacy/loaders",
          label: "loaders",
          icons: ["loader"],
          entities: ["loader", "fast-loader", "express-loader"],
        },
        {
          kind: "page",
          id: "internal-legacy/belts",
          label: "belts",
          icons: ["linked-belt"],
          entities: ["lane-splitter", "linked-belt"],
        },
        {
          kind: "page",
          id: "internal-legacy/containers",
          label: "containers",
          icons: ["infinity-chest"],
          entities: ["linked-chest", "infinity-chest", "bottomless-chest", "proxy-container"],
        },
        {
          kind: "page",
          id: "internal-legacy/fluid",
          label: "fluid",
          icons: ["infinity-pipe"],
          entities: ["infinity-pipe", "one-way-valve", "overflow-valve", "top-up-valve"],
        },
        {
          kind: "page",
          id: "internal-legacy/interfaces",
          label: "interfaces",
          icons: ["electric-energy-interface"],
          entities: ["electric-energy-interface", "heat-interface", "burner-generator"],
        },
        {
          kind: "page",
          id: "internal-legacy/infinity-cargo-wagon",
          label: "infinity cargo wagon",
          icons: ["infinity-cargo-wagon"],
          entities: ["infinity-cargo-wagon"],
        },
        {
          kind: "page",
          id: "internal-legacy/simple-entities",
          label: "simple entities",
          icons: ["simple-entity-with-owner"],
          entities: ["simple-entity-with-force", "simple-entity-with-owner"],
        },
        {
          kind: "page",
          id: "internal-legacy/legacy-rails",
          label: "legacy rails",
          icons: ["rail"],
          entities: ["legacy-straight-rail", "legacy-curved-rail"],
        },
      ],
    },
  ],
} as const satisfies FactorioModBookSpec;

export const BASE_GAME_PAGE_SPECS = Object.freeze(pagesInBook(BASE_GAME_BOOK_SPEC));

export const BASE_ENTITY_NAMES = Object.freeze(entityNamesInBook(BASE_GAME_BOOK_SPEC));

export const BASE_TILE_NAMES = Object.freeze(tileNamesInBook(BASE_GAME_BOOK_SPEC));

export function baseGamePageSpec(id: string): BaseGamePageSpec {
  return pageInBook(BASE_GAME_BOOK_SPEC, id);
}

export function baseGameRootBookSpec(id: string): BaseGameBookSpec {
  return rootBookIn(BASE_GAME_BOOK_SPEC, id);
}

export const BASE_ORIENTATION_64_ENTITIES = new Set([
  "locomotive",
  "cargo-wagon",
  "fluid-wagon",
  "artillery-wagon",
  "infinity-cargo-wagon",
  "car",
  "tank",
  "spidertron",
]);

export const BASE_DIRECTION_16_ENTITIES = new Set([
  "rail-signal",
  "rail-chain-signal",
  "construction-robot",
  "logistic-robot",
]);

export const BASE_DIRECTION_8_ENTITIES = new Set([
  "straight-rail",
  "curved-rail-a",
  "curved-rail-b",
  "half-diagonal-rail",
  "legacy-straight-rail",
  "legacy-curved-rail",
]);
