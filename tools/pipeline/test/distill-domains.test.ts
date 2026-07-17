import { describe, expect, it } from "vite-plus/test";
import { entityKindForProtoType, routeEntityPrototype } from "../src/distill/domains/index.js";

describe("Wiki-aligned distill domains", () => {
  it.each([
    ["transport-belt", "logistics", "belt"],
    ["rail-signal", "logistics", "rail-signal"],
    ["artillery-turret", "combat", "turret"],
    ["artillery-wagon", "combat", "train"],
    ["space-platform-hub", "space", "space-structure"],
    ["asteroid-collector", "space", "asteroid-collector"],
    ["assembling-machine", "production", "assembler"],
    ["fusion-reactor", "production", "fusion-reactor"],
  ] as const)("routes %s to %s", (protoType, domain, strategy) => {
    expect(routeEntityPrototype(protoType)).toEqual({ domain, strategy });
  });

  it("keeps unknown prototypes on the generic fallback", () => {
    expect(routeEntityPrototype("modded-machine")).toEqual({
      domain: "other",
      strategy: "generic",
    });
  });

  it.each([
    ["transport-belt", "belt"],
    ["assembling-machine", "assembler"],
    ["artillery-wagon", "train"],
    ["modded-machine", "simple"],
  ] as const)("maps %s to renderer kind %s", (protoType, kind) => {
    expect(entityKindForProtoType(protoType)).toBe(kind);
  });
});
