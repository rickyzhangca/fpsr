import type { DistillDomainRoutes } from "./types.js";

/** Factorio Wiki Combat: fortifications, detection, turrets, mines, and armed vehicles. */
export const COMBAT_ROUTES = {
  wall: "wall",
  gate: "gate",
  radar: "radar",
  "ammo-turret": "turret",
  "electric-turret": "turret",
  "fluid-turret": "turret",
  "artillery-turret": "turret",
  "artillery-wagon": "train",
  "land-mine": "land-mine",
  car: "vehicle",
  "spider-vehicle": "spider-vehicle",
} as const satisfies DistillDomainRoutes;
