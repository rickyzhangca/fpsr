export const BASE_GAME_VERSION = "2.1.11";

/**
 * Curated and audited against Factorio 2.1.11 with only the base mod enabled.
 * This list owns the stable grouping/order contract; the exact Base render DB
 * independently gates the generator's prototype coverage.
 */
export const BASE_ENTITY_GROUPS = {
  logistics: [
    "transport-belt",
    "fast-transport-belt",
    "express-transport-belt",
    "underground-belt",
    "fast-underground-belt",
    "express-underground-belt",
    "splitter",
    "fast-splitter",
    "express-splitter",
    "burner-inserter",
    "inserter",
    "long-handed-inserter",
    "fast-inserter",
    "bulk-inserter",
    "wooden-chest",
    "iron-chest",
    "steel-chest",
    "storage-tank",
    "passive-provider-chest",
    "active-provider-chest",
    "storage-chest",
    "buffer-chest",
    "requester-chest",
    "construction-robot",
    "logistic-robot",
    "roboport",
  ],
  production: [
    "burner-mining-drill",
    "electric-mining-drill",
    "pumpjack",
    "stone-furnace",
    "steel-furnace",
    "electric-furnace",
    "assembling-machine-1",
    "assembling-machine-2",
    "assembling-machine-3",
    "lab",
    "beacon",
    "centrifuge",
    "chemical-plant",
    "oil-refinery",
    "rocket-silo",
    "cargo-landing-pad",
    "radar",
  ],
  "fluids-heat": [
    "offshore-pump",
    "pipe",
    "pipe-to-ground",
    "pump",
    "boiler",
    "steam-engine",
    "steam-turbine",
    "heat-exchanger",
    "heat-pipe",
    "nuclear-reactor",
  ],
  power: [
    "small-electric-pole",
    "medium-electric-pole",
    "big-electric-pole",
    "substation",
    "accumulator",
    "solar-panel",
  ],
  circuit: [
    "arithmetic-combinator",
    "decider-combinator",
    "constant-combinator",
    "selector-combinator",
    "display-panel",
    "small-lamp",
    "programmable-speaker",
    "power-switch",
  ],
  defense: [
    "stone-wall",
    "gate",
    "land-mine",
    "gun-turret",
    "laser-turret",
    "flamethrower-turret",
    "artillery-turret",
  ],
  rail: [
    "straight-rail",
    "curved-rail-a",
    "curved-rail-b",
    "half-diagonal-rail",
    "rail-signal",
    "rail-chain-signal",
    "train-stop",
    "locomotive",
    "cargo-wagon",
    "fluid-wagon",
    "artillery-wagon",
  ],
  vehicles: ["car", "tank", "spidertron"],
  internal: [
    "loader",
    "fast-loader",
    "express-loader",
    "lane-splitter",
    "linked-belt",
    "linked-chest",
    "infinity-chest",
    "infinity-pipe",
    "infinity-cargo-wagon",
    "electric-energy-interface",
    "heat-interface",
    "burner-generator",
    "simple-entity-with-force",
    "simple-entity-with-owner",
    "proxy-container",
    "bottomless-chest",
    "one-way-valve",
    "overflow-valve",
    "top-up-valve",
    "legacy-straight-rail",
    "legacy-curved-rail",
  ],
} as const;

export type BaseEntityGroupId = keyof typeof BASE_ENTITY_GROUPS;

export const BASE_ENTITY_NAMES = Object.freeze(
  Object.values(BASE_ENTITY_GROUPS).flatMap((names) => [...names]),
);

export const BASE_INTERNAL_ENTITY_NAMES = new Set<string>(BASE_ENTITY_GROUPS.internal);

export const BASE_TILE_NAMES = [
  "stone-path",
  "concrete",
  "hazard-concrete-left",
  "hazard-concrete-right",
  "refined-concrete",
  "refined-hazard-concrete-left",
  "refined-hazard-concrete-right",
  "landfill",
] as const;

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
