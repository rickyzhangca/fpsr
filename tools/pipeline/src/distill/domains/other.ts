import type { DistillDomainRoutes } from "./types.js";

/** Placeable prototypes outside the four Wiki categories that still have explicit graphics. */
export const OTHER_ROUTES = {
  "simple-entity-with-owner": "simple-picture",
  "simple-entity-with-force": "simple-picture",
} as const satisfies DistillDomainRoutes;
