import type { DistillDomainRoutes } from "./types.js";

/** Factorio Wiki Production: extraction, processing, power generation, and research. */
export const PRODUCTION_ROUTES = {
  "assembling-machine": "assembler",
  furnace: "furnace",
  "solar-panel": "simple-picture",
  accumulator: "accumulator",
  "lightning-attractor": "accumulator",
  lab: "lab",
  beacon: "beacon",
  "mining-drill": "mining-drill",
  "heat-pipe": "heat-pipe",
  boiler: "boiler",
  "offshore-pump": "offshore-pump",
  generator: "steam-engine",
  "burner-generator": "steam-engine",
  reactor: "reactor",
  "fusion-reactor": "fusion-reactor",
  "fusion-generator": "fusion-generator",
  "agricultural-tower": "agricultural-tower",
  "electric-energy-interface": "simple-picture",
  "heat-interface": "simple-picture",
} as const satisfies DistillDomainRoutes;
