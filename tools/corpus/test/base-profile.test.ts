import { describe, expect, it } from "vite-plus/test";
import {
  discoverBaseProfile,
  isBaseIconPath,
  isExcludedElevatedRail,
  primaryIconPath,
  type DataRaw,
} from "../src/base-profile.js";

/** Minimal synthetic data.raw — not a real Factorio dump. */
function syntheticRaw(): DataRaw {
  return {
    item: {
      "transport-belt": {
        type: "item",
        name: "transport-belt",
        icon: "__base__/graphics/icons/transport-belt.png",
        place_result: "transport-belt",
      },
      "turbo-transport-belt": {
        type: "item",
        name: "turbo-transport-belt",
        icon: "__space-age__/graphics/icons/turbo-transport-belt.png",
        place_result: "turbo-transport-belt",
      },
      loader: {
        type: "item",
        name: "loader",
        icon: "__base__/graphics/icons/loader.png",
        place_result: "loader",
        hidden: true,
      },
      "rail-support": {
        type: "item",
        name: "rail-support",
        icon: "__elevated-rails__/graphics/icons/rail-support.png",
        place_result: "rail-support",
      },
      "modded-machine": {
        type: "item",
        name: "modded-machine",
        icons: [{ icon: "__mymod__/graphics/icons/machine.png" }],
        place_result: "modded-machine",
      },
      "layered-base": {
        type: "item",
        name: "layered-base",
        icons: [
          { icon: "__base__/graphics/icons/steel-chest.png" },
          { icon: "__core__/graphics/icons/mip/infinity.png" },
        ],
        place_result: "layered-base",
        hidden: true,
      },
    },
    "item-with-entity-data": {
      locomotive: {
        type: "item-with-entity-data",
        name: "locomotive",
        icon: "__base__/graphics/icons/locomotive.png",
        place_result: "locomotive",
      },
    },
    "rail-planner": {
      rail: {
        type: "rail-planner",
        name: "rail",
        icon: "__base__/graphics/icons/rail.png",
        place_result: "straight-rail",
        rails: [
          "straight-rail",
          "curved-rail-a",
          "half-diagonal-rail",
          "rail-ramp",
          "elevated-straight-rail",
        ],
      },
      "rail-ramp": {
        type: "rail-planner",
        name: "rail-ramp",
        icon: "__elevated-rails__/graphics/icons/rail-ramp.png",
        place_result: "rail-ramp",
        rails: ["straight-rail", "rail-ramp", "elevated-straight-rail"],
      },
    },
    "transport-belt": {
      "transport-belt": {
        type: "transport-belt",
        name: "transport-belt",
        collision_box: [
          [-0.4, -0.4],
          [0.4, 0.4],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    loader: {
      loader: {
        type: "loader",
        name: "loader",
        hidden: true,
        collision_box: [
          [-0.4, -0.4],
          [0.4, 0.4],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    locomotive: {
      locomotive: {
        type: "locomotive",
        name: "locomotive",
        collision_box: [
          [-0.6, -2],
          [0.6, 2],
        ],
        flags: ["placeable-neutral", "player-creation", "placeable-off-grid"],
      },
    },
    "straight-rail": {
      "straight-rail": {
        type: "straight-rail",
        name: "straight-rail",
        collision_box: [
          [-0.7, -0.8],
          [0.7, 0.8],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    "curved-rail-a": {
      "curved-rail-a": {
        type: "curved-rail-a",
        name: "curved-rail-a",
        collision_box: [
          [-0.7, -0.8],
          [0.7, 0.8],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    "half-diagonal-rail": {
      "half-diagonal-rail": {
        type: "half-diagonal-rail",
        name: "half-diagonal-rail",
        collision_box: [
          [-0.7, -0.8],
          [0.7, 0.8],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    "rail-ramp": {
      "rail-ramp": {
        type: "rail-ramp",
        name: "rail-ramp",
        collision_box: [
          [-1, -1],
          [1, 1],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    "elevated-straight-rail": {
      "elevated-straight-rail": {
        type: "elevated-straight-rail",
        name: "elevated-straight-rail",
        collision_box: [
          [-0.7, -0.8],
          [0.7, 0.8],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    "rail-support": {
      "rail-support": {
        type: "rail-support",
        name: "rail-support",
        collision_box: [
          [-0.5, -0.5],
          [0.5, 0.5],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
    container: {
      "layered-base": {
        type: "container",
        name: "layered-base",
        hidden: true,
        collision_box: [
          [-0.4, -0.4],
          [0.4, 0.4],
        ],
        flags: ["placeable-neutral", "player-creation"],
      },
    },
  };
}

describe("primaryIconPath / helpers", () => {
  it("prefers the first icons layer over singular icon", () => {
    expect(
      primaryIconPath({
        icon: "__base__/graphics/icons/a.png",
        icons: [{ icon: "__base__/graphics/icons/b.png" }],
      }),
    ).toBe("__base__/graphics/icons/b.png");
  });

  it("accepts only __base__ icon paths", () => {
    expect(isBaseIconPath("__base__/graphics/icons/x.png")).toBe(true);
    expect(isBaseIconPath("__space-age__/graphics/icons/x.png")).toBe(false);
  });

  it("classifies elevated rails / ramp / support as excluded", () => {
    expect(isExcludedElevatedRail("elevated-straight-rail")).toBe(true);
    expect(isExcludedElevatedRail("rail-ramp")).toBe(true);
    expect(isExcludedElevatedRail("rail-support")).toBe(true);
    expect(isExcludedElevatedRail("straight-rail")).toBe(false);
  });
});

describe("discoverBaseProfile", () => {
  it("includes __base__ place_results and item-with-entity-data; excludes other mods", () => {
    const { entries } = discoverBaseProfile(syntheticRaw(), { dumpStatus: "synthetic" });
    const names = entries.map((e) => e.entityName);
    expect(names).toContain("transport-belt");
    expect(names).toContain("locomotive");
    expect(names).toContain("layered-base");
    expect(names).not.toContain("turbo-transport-belt");
    expect(names).not.toContain("modded-machine");
    expect(names).not.toContain("rail-support");
  });

  it("adds base ground rails from a base rail-planner and skips elevated/ramp", () => {
    const { entries } = discoverBaseProfile(syntheticRaw(), { dumpStatus: "synthetic" });
    const names = new Set(entries.map((e) => e.entityName));
    expect(names.has("straight-rail")).toBe(true);
    expect(names.has("curved-rail-a")).toBe(true);
    expect(names.has("half-diagonal-rail")).toBe(true);
    expect(names.has("rail-ramp")).toBe(false);
    expect(names.has("elevated-straight-rail")).toBe(false);

    const curved = entries.find((e) => e.entityName === "curved-rail-a");
    expect(curved?.evidence).toEqual({
      kind: "rail-planner.rails",
      planner: "rail",
      icon: "__base__/graphics/icons/rail.png",
    });
    expect(curved?.itemType).toBe("rail-planner");
  });

  it("preserves hidden/internal classification and proto types", () => {
    const { entries } = discoverBaseProfile(syntheticRaw(), { dumpStatus: "synthetic" });
    const loader = entries.find((e) => e.entityName === "loader");
    expect(loader?.hidden).toBe(true);
    expect(loader?.protoType).toBe("loader");
    expect(loader?.itemName).toBe("loader");
    expect(loader?.evidence.kind).toBe("place_result");

    const belt = entries.find((e) => e.entityName === "transport-belt");
    expect(belt?.hidden).toBe(false);
    expect(belt?.protoType).toBe("transport-belt");
  });

  it("returns deterministic sorted entries", () => {
    const { entries } = discoverBaseProfile(syntheticRaw(), { dumpStatus: "synthetic" });
    const names = entries.map((e) => e.entityName);
    expect(names).toEqual([...names].sort());
  });

  it("exposes provenance that does not claim a base-only oracle", () => {
    const result = discoverBaseProfile(syntheticRaw(), {
      dumpStatus: "merged-official-mods",
    });
    expect(result.provenance.claimsBaseOnlyOracle).toBe(false);
    expect(result.provenance.inventorySource).toBe("data-raw-__base__-icons");
    expect(result.provenance.dumpStatus).toBe("merged-official-mods");
  });

  it("records an explicitly Base-only dump as a Base oracle", () => {
    const result = discoverBaseProfile(syntheticRaw(), { dumpStatus: "base-only" });
    expect(result.provenance.claimsBaseOnlyOracle).toBe(true);
    expect(result.provenance.dumpStatus).toBe("base-only");
  });

  it("reports missing render defs without dropping inventory entries", () => {
    const raw = syntheticRaw();
    const result = discoverBaseProfile(raw, {
      dumpStatus: "synthetic",
      renderDb: {
        mods: ["base", "elevated-rails", "space-age"],
        entities: {
          "transport-belt": { kind: "belt" } as never,
        },
      },
    });
    expect(result.entries.some((e) => e.entityName === "loader")).toBe(true);
    expect(result.missingRenderDefs).toContain("loader");
    expect(result.missingRenderDefs).toContain("straight-rail");
    expect(result.missingRenderDefs).not.toContain("transport-belt");
    expect(result.provenance.renderDbMods).toEqual(["base", "elevated-rails", "space-age"]);
    // Inventory size unchanged vs no renderDb.
    const without = discoverBaseProfile(raw, { dumpStatus: "synthetic" });
    expect(result.entries.map((e) => e.entityName)).toEqual(
      without.entries.map((e) => e.entityName),
    );
  });
});
