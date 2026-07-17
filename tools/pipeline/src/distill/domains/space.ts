import type { DistillDomainRoutes } from "./types.js";

/** Factorio Wiki Space: launch, platforms, orbital logistics, and asteroids. */
export const SPACE_ROUTES = {
  "rocket-silo": "rocket-silo",
  "space-platform-hub": "space-structure",
  "cargo-bay": "space-structure",
  "cargo-landing-pad": "space-structure",
  thruster: "thruster",
  "asteroid-collector": "asteroid-collector",
} as const satisfies DistillDomainRoutes;
