import type { EntityKind } from "../../types.js";
import { COMBAT_ROUTES } from "./combat.js";
import { LOGISTICS_ROUTES } from "./logistics.js";
import { OTHER_ROUTES } from "./other.js";
import { PRODUCTION_ROUTES } from "./production.js";
import { SPACE_ROUTES } from "./space.js";
import type { DistillDomain, DistillRoute, DistillStrategy } from "./types.js";

export type { DistillDomain, DistillRoute, DistillStrategy } from "./types.js";

const DOMAIN_ROUTES: readonly [DistillDomain, Readonly<Record<string, DistillStrategy>>][] = [
  ["logistics", LOGISTICS_ROUTES],
  ["combat", COMBAT_ROUTES],
  ["space", SPACE_ROUTES],
  ["production", PRODUCTION_ROUTES],
  ["other", OTHER_ROUTES],
];

const ROUTES = new Map<string, DistillRoute>();
for (const [domain, routes] of DOMAIN_ROUTES) {
  for (const [protoType, strategy] of Object.entries(routes)) {
    const previous = ROUTES.get(protoType);
    if (previous) {
      throw new Error(`Duplicate distill route for ${protoType}: ${previous.domain}, ${domain}`);
    }
    ROUTES.set(protoType, { domain, strategy });
  }
}

const ENTITY_KINDS: Readonly<Record<string, EntityKind>> = {
  "transport-belt": "belt",
  "underground-belt": "underground-belt",
  loader: "loader",
  "loader-1x1": "loader",
  "linked-belt": "loader",
  splitter: "splitter",
  "lane-splitter": "splitter",
  pipe: "pipe",
  "infinity-pipe": "pipe",
  "heat-pipe": "heat-pipe",
  wall: "wall",
  gate: "gate",
  inserter: "inserter",
  "assembling-machine": "assembler",
  "straight-rail": "rail",
  "half-diagonal-rail": "rail",
  "curved-rail-a": "rail",
  "curved-rail-b": "rail",
  "legacy-straight-rail": "rail",
  "legacy-curved-rail": "rail",
  "elevated-straight-rail": "rail",
  "elevated-half-diagonal-rail": "rail",
  "elevated-curved-rail-a": "rail",
  "elevated-curved-rail-b": "rail",
  "rail-ramp": "rail",
  "rail-signal": "rail-signal",
  "rail-chain-signal": "rail-signal",
  locomotive: "train",
  "cargo-wagon": "train",
  "fluid-wagon": "train",
  "artillery-wagon": "train",
  "infinity-cargo-wagon": "train",
};

export function routeEntityPrototype(protoType: string): DistillRoute {
  return ROUTES.get(protoType) ?? { domain: "other", strategy: "generic" };
}

export function entityKindForProtoType(protoType: string): EntityKind {
  return ENTITY_KINDS[protoType] ?? "simple";
}
