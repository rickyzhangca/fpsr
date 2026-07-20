import { describe, expect, it } from "vite-plus/test";
import {
  altSignalFrame,
  planAltModeCommands,
  planRequestPinCommands,
  signalIconKeys,
} from "../src/alt-mode.js";
import type { BlueprintEntity } from "../src/types/blueprint.js";
import { RENDER_LAYERS } from "../src/types/draw-list.js";
import type { EntityRenderDef, RenderDb } from "../src/types/render-db.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

function fixture(): { db: RenderDb; def: EntityRenderDef } {
  const db = makeMiniDb();
  Object.assign(db.icons, {
    "item/copper-plate": 3,
    "item/productivity-module-3": 3,
    "item/speed-module-3": 2,
    "fluid/water": 3,
    "virtual-signal/signal-A": 3,
    "quality/legendary": 3,
    "utility/entity-info-dark-background": 3,
    "utility/item-request-slot": 4,
    "utility/missing-icon": 3,
    "utility/filter-blacklist": 3,
    "utility/indication-arrow": 3,
    "virtual-signal/signal-no-entry": 3,
  });
  db.iconScales = { "utility/indication-arrow": 0.5 };
  // Match distilled pin trim (48×63 in a 64×64 cell) so spacing uses content width.
  db.frames[4] = { a: 0, x: 0, y: 0, w: 48, h: 63, ox: 8, oy: 1, sw: 64, sh: 64 };
  const def: EntityRenderDef = {
    ...db.entities["assembling-machine-1"]!,
    protoType: "constant-combinator",
    iconDrawSpecification: {
      shift: [0.25, -0.25],
      scale: 0.8,
      scaleForMany: 0.4,
      renderLayer: "entity-info-icon-above",
    },
  };
  return { db, def };
}

describe("signalIconKeys", () => {
  it("maps blueprint signal types to ordered render-db icon keys", () => {
    expect(signalIconKeys({ name: "assembling-machine-2" })).toEqual([
      "item/assembling-machine-2",
      "entity/assembling-machine-2",
      "recipe/assembling-machine-2",
    ]);
    expect(signalIconKeys({ name: "transport-belt" })).toEqual([
      "item/transport-belt",
      "entity/transport-belt",
      "recipe/transport-belt",
    ]);
    expect(signalIconKeys({ type: "virtual", name: "signal-2", quality: "rare" })).toEqual([
      "virtual-signal/signal-2",
    ]);
    expect(
      signalIconKeys({
        type: "recipe",
        name: "simple-coal-liquefaction",
        quality: "legendary",
      }),
    ).toEqual(["recipe/simple-coal-liquefaction", "item/simple-coal-liquefaction"]);
    expect(signalIconKeys({ type: "fluid", name: "water" })).toEqual(["fluid/water"]);
    expect(signalIconKeys({ type: "entity", name: "assembling-machine-2" })).toEqual([
      "entity/assembling-machine-2",
      "item/assembling-machine-2",
    ]);
    expect(signalIconKeys({ type: "tile", name: "frozen-concrete" })).toEqual([
      "tile/frozen-concrete",
    ]);
  });
});

describe("alt-mode planner", () => {
  it("maps every Blueprint SignalID namespace and falls back safely", () => {
    const { db } = fixture();
    expect(altSignalFrame(db, { name: "iron-plate" })).toBe(3);
    expect(altSignalFrame(db, { type: "fluid", name: "water" })).toBe(3);
    expect(altSignalFrame(db, { type: "virtual", name: "signal-A" })).toBe(3);
    expect(altSignalFrame(db, { type: "entity", name: "not-an-item" })).toBeUndefined();
  });

  it("collects requests and inventories without exposing combinator internals", () => {
    const { db, def } = fixture();
    const entity: BlueprintEntity = {
      entity_number: 9,
      name: "constant-combinator",
      position: { x: 3, y: 4 },
      items: [{ id: { name: "iron-plate", quality: "legendary" } }],
      inventory: { filters: [{ index: 1, name: "copper-plate" }] },
      request_filters: {
        sections: [{ filters: [{ value: { type: "fluid", name: "water" } }] }],
      },
      control_behavior: {
        sections: [{ filters: [{ value: { type: "virtual", name: "signal-A" } }] }],
      },
    };
    const pins = planRequestPinCommands(entity, def, db);
    const commands = planAltModeCommands(entity, def, db, { insertCommands: pins });
    const primary = commands.filter((c) => c.sub < 20);
    expect(primary).toHaveLength(2);
    expect(primary.every((c) => c.size === 0.4)).toBe(true);
    expect(primary.every((c) => c.layer === RENDER_LAYERS["entity-info-icon-above"])).toBe(true);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.size).toBe(36 / 64);
    expect(commands.some((c) => c.sub === 60 && c.size === (36 / 64) * 0.5)).toBe(true);
    expect(planAltModeCommands(entity, def, db, { insertCommands: pins })).toEqual(commands);
  });

  it("shows display-panel static icon but not multi-parameter circuit signals", () => {
    const { db, def } = fixture();
    const panelDef: EntityRenderDef = { ...def, protoType: "display-panel" };

    const multi = planAltModeCommands(
      {
        entity_number: 3,
        name: "display-panel",
        position: { x: 1, y: 2 },
        control_behavior: {
          parameters: [
            { icon: { type: "virtual", name: "signal-0" } },
            { icon: { type: "virtual", name: "signal-1" } },
            { icon: { type: "virtual", name: "signal-A" } },
          ],
        },
      },
      panelDef,
      db,
    );
    expect(multi.filter((c) => c.sub < 20)).toHaveLength(0);

    const single = planAltModeCommands(
      {
        entity_number: 18,
        name: "display-panel",
        position: { x: 3, y: 4 },
        icon: { type: "virtual", name: "signal-A" },
        text: ":",
      },
      panelDef,
      db,
    );
    const primary = single.filter((c) => c.sub < 20);
    expect(primary).toHaveLength(1);
    expect(primary[0]!.size).toBe(0.8);
  });

  it("renders combinator flow arrows and an empty enabled inserter filter marker", () => {
    const { db, def } = fixture();
    const combinatorDef: EntityRenderDef = {
      ...def,
      protoType: "arithmetic-combinator",
      selectionBox: [
        [-0.5, -1],
        [0.5, 1],
      ],
    };
    const arrows = planAltModeCommands(
      {
        entity_number: 10,
        name: "arithmetic-combinator",
        position: { x: 2, y: 3 },
        control_behavior: {
          arithmetic_conditions: {
            first_signal: { type: "virtual", name: "signal-A" },
            operation: "*",
          },
        },
      },
      combinatorDef,
      db,
    );
    expect(arrows).toHaveLength(2);
    expect(arrows.every((command) => command.rotation === 0)).toBe(true);
    // The mini-db arrow frame is fully opaque, so one visible icon height
    // (0.75 tiles) moves each marker inward from the ±1-tile selection edge.
    expect(arrows.map((command) => command.y).sort((a, b) => a - b)).toEqual([2.75, 3.25]);

    const inserterDef: EntityRenderDef = { ...def, kind: "inserter", protoType: "inserter" };
    const empty = planAltModeCommands(
      {
        entity_number: 11,
        name: "bulk-inserter",
        position: { x: 5, y: 6 },
        use_filters: true,
      },
      inserterDef,
      db,
    );
    expect(empty).toHaveLength(1);
    expect(empty[0]?.frame).toBe(db.icons["virtual-signal/signal-no-entry"]);
    expect(empty[0]?.silhouette).toBe(true);
    expect(empty[0]).not.toHaveProperty("backing");
    expect(empty[0]).not.toHaveProperty("backingFrame");
  });

  it("expands beacon and assembler inventory placements into fixed-size single-row slots", () => {
    const { db } = fixture();
    const baseDef = db.entities["assembling-machine-1"]!;
    const beaconDef: EntityRenderDef = {
      ...baseDef,
      protoType: "beacon",
      kind: "simple",
    };
    const beacon: BlueprintEntity = {
      entity_number: 1,
      name: "beacon",
      position: { x: 5, y: 6 },
      items: [
        {
          id: { name: "speed-module-3" },
          items: {
            in_inventory: [
              { inventory: 1, stack: 1 },
              { inventory: 1, stack: 0 },
            ],
          },
        },
      ],
    };
    const beaconCommands = planRequestPinCommands(beacon, beaconDef, db);
    expect(beaconCommands).toHaveLength(2);
    expect(beaconCommands.every((command) => command.size === 36 / 64)).toBe(true);
    expect(beaconCommands[0]!.x).toBeLessThan(beaconCommands[1]!.x);
    expect(beaconCommands.every((command) => command.y === 6)).toBe(true);
    expect(beaconCommands.every((command) => command.backingStyle === "request-pin")).toBe(true);
    expect(beaconCommands.every((command) => command.backingFrame === 4)).toBe(true);

    const assemblerDef: EntityRenderDef = {
      ...baseDef,
      iconDrawSpecification: {
        shift: [0, -0.3],
        scale: 1,
        scaleForMany: 1,
        renderLayer: "entity-info-icon",
      },
    };
    const assembler: BlueprintEntity = {
      entity_number: 2,
      name: "assembling-machine-3",
      position: { x: 3, y: 4 },
      recipe: "iron-gear-wheel",
      items: [
        {
          id: { name: "productivity-module-3" },
          items: {
            in_inventory: [0, 1, 2, 3].map((stack) => ({ inventory: 4, stack })),
          },
        },
      ],
    };
    const recipe = planAltModeCommands(assembler, assemblerDef, db).find(
      (command) => command.sub === 0,
    )!;
    const slots = planRequestPinCommands(assembler, assemblerDef, db);
    expect(recipe.size).toBe(1);
    expect(recipe.y).toBe(3.7);
    expect(recipe.backingStyle).toBeUndefined();
    expect(slots).toHaveLength(4);
    expect(slots.every((command) => command.size === 36 / 64)).toBe(true);
    expect(slots.every((command) => command.y > recipe.y)).toBe(true);
    expect(new Set(slots.map((command) => command.y)).size).toBe(1);
    expect(slots.every((command) => command.backingStyle === "request-pin")).toBe(true);
    expect(slots.every((command) => command.backingFrame === 4)).toBe(true);
    const slotXs = slots.map((command) => command.x);
    expect(slotXs).toEqual(slotXs.slice().sort((a, b) => a - b));
    // 36 px pins with 2 px gaps at 64 ppt → step = 38/64 tiles.
    expect(slotXs[1]! - slotXs[0]!).toBeCloseTo(38 / 64);
  });

  it("places rolling-stock insert-plan pins half a pin-height below center", () => {
    const { db } = fixture();
    Object.assign(db.icons, { "item/coal": 3 });
    const pinSize = 36 / 64;
    const expectedY = 20 + (pinSize * (62 / 44)) / 2;

    const locoDef: EntityRenderDef = {
      ...db.entities["assembling-machine-1"]!,
      protoType: "locomotive",
      kind: "train",
      iconDrawSpecification: undefined,
    };
    const locoPins = planRequestPinCommands(
      {
        entity_number: 3,
        name: "locomotive",
        position: { x: 10, y: 20 },
        items: [{ id: { name: "coal" }, items: { in_inventory: [{ inventory: 1, stack: 0 }] } }],
      },
      locoDef,
      db,
    );
    expect(locoPins).toHaveLength(1);
    expect(locoPins[0]!.y).toBeCloseTo(expectedY);
    expect(locoPins[0]!.backingStyle).toBe("request-pin");

    const wagonDef: EntityRenderDef = {
      ...db.entities["assembling-machine-1"]!,
      protoType: "cargo-wagon",
      kind: "train",
      iconDrawSpecification: {
        shift: [0, -0.5],
        scale: 1.5,
        scaleForMany: 2.5,
        renderLayer: "entity-info-icon",
      },
    };
    const wagonPins = planRequestPinCommands(
      {
        entity_number: 4,
        name: "cargo-wagon",
        position: { x: 10, y: 20 },
        items: [{ id: { name: "coal" }, items: { in_inventory: [{ inventory: 1, stack: 0 }] } }],
      },
      wagonDef,
      db,
    );
    expect(wagonPins).toHaveLength(1);
    // Cargo badge shift must not pull request pins upward.
    expect(wagonPins[0]!.y).toBeCloseTo(expectedY);
  });

  it("dedupes fuel request pins to one pin per kind, ignoring stack count", () => {
    const { db } = fixture();
    Object.assign(db.icons, { "item/coal": 5, "item/nuclear-fuel": 6 });
    const locoDef: EntityRenderDef = {
      ...db.entities["assembling-machine-1"]!,
      protoType: "locomotive",
      kind: "train",
      iconDrawSpecification: undefined,
    };
    const pins = planRequestPinCommands(
      {
        entity_number: 8,
        name: "locomotive",
        position: { x: 0, y: 0 },
        items: [
          {
            id: { name: "coal" },
            items: { in_inventory: [{ inventory: 1, stack: 0, count: 50 }] },
          },
          {
            id: { name: "nuclear-fuel" },
            items: { in_inventory: [{ inventory: 1, stack: 1, count: 5 }] },
          },
          {
            id: { name: "coal" },
            items: { in_inventory: [{ inventory: 1, stack: 2, count: 10 }] },
          },
        ],
      },
      locoDef,
      db,
    );
    expect(pins).toHaveLength(2);
    expect(pins.map((command) => command.frame)).toEqual([5, 6]);
  });

  it("preserves mixed slot order, per-position counts, qualities, and grid-count fallback", () => {
    const { db } = fixture();
    const def = db.entities["assembling-machine-1"]!;
    const entity: BlueprintEntity = {
      entity_number: 7,
      name: "assembling-machine-1",
      position: { x: 0, y: 0 },
      items: [
        {
          id: { name: "speed-module-3", quality: "legendary" },
          items: { in_inventory: [{ inventory: 4, stack: 2, count: 2 }] },
        },
        {
          id: { name: "productivity-module-3" },
          items: { in_inventory: [{ inventory: 4, stack: 0 }] },
        },
        { id: { name: "copper-plate" }, items: { grid_count: 2 } },
      ],
    };
    const slots = planRequestPinCommands(entity, def, db);
    expect(slots).toHaveLength(5);
    expect(slots.map((command) => command.frame)).toEqual([3, 2, 2, 3, 3]);
    const withBadges = planAltModeCommands(entity, def, db, { insertCommands: slots });
    expect(withBadges.filter((command) => command.sub >= 60 && command.sub < 80)).toHaveLength(2);
    expect(
      planAltModeCommands(entity, def, db).filter(
        (command) => command.sub >= 60 && command.sub < 80,
      ),
    ).toHaveLength(0);
  });

  it("uses missing icon, blacklist marker, and mirrored directional splitter priorities", () => {
    const { db, def } = fixture();
    const splitterDef: EntityRenderDef = {
      ...def,
      protoType: "splitter",
      kind: "splitter",
      iconDrawSpecification: {
        shift: [0, 0],
        scale: 0.5,
        scaleForMany: 0.5,
        renderLayer: "entity-info-icon",
      },
    };
    const entity: BlueprintEntity = {
      entity_number: 2,
      name: "splitter",
      position: { x: 0, y: 0 },
      direction: 4,
      mirror: true,
      filters: [{ name: "modded-item" }],
      filter_mode: "blacklist",
      input_priority: "left",
      output_priority: "right",
    };
    const commands = planAltModeCommands(entity, splitterDef, db);
    // Filter sits on the output-priority lane (mirrored right→left), not entity center.
    const filter = commands.find((c) => c.rotation == null && c.backingFrame != null)!;
    expect(filter.frame).toBe(db.icons["utility/missing-icon"]);
    expect(filter.size).toBe(0.5);
    expect(filter.x).toBeCloseTo(0);
    expect(filter.y).toBeCloseTo(-0.5);
    expect(commands.some((c) => c.frame === db.icons["utility/filter-blacklist"])).toBe(true);
    // Input arrow only; both sides point along belt travel (east = 90°). Mirror swaps lanes.
    expect(commands.filter((c) => c.rotation != null).map((c) => c.rotation)).toEqual([90]);
    const arrow = commands.find((c) => c.rotation != null)!;
    expect(arrow.size).toBe(0.5);
    expect(arrow.x).toBeCloseTo(-0.25);
    expect(arrow.y).toBeCloseTo(0.5);
  });

  it("renders blue fluid-indication arrows at active openings with flow rotation", () => {
    const { db } = fixture();
    Object.assign(db.icons, {
      "utility/fluid-indication-arrow": 5,
      "utility/fluid-indication-arrow-both-ways": 6,
    });
    db.iconScales = {
      ...db.iconScales,
      "utility/fluid-indication-arrow": 0.5,
      "utility/fluid-indication-arrow-both-ways": 0.5,
    };
    db.fluidRecipes = {
      concrete: { ingredients: true, products: false },
      "sulfuric-acid": { ingredients: true, products: true },
    };

    const am2: EntityRenderDef = {
      ...db.entities["assembling-machine-1"]!,
      kind: "assembler",
      protoType: "assembling-machine",
      data: {
        fluidBoxesRequireFluidRecipe: true,
        fluidConnections: {
          "0": [
            [0, -2],
            [0, 2],
          ],
        },
        fluidConnectionRoles: { "0": ["input", "output"] },
        fluidConnectionFlows: { "0": ["input", "output"] },
        fluidConnectionFacings: { "0": [0, 8] },
        fluidConnectionHideInfo: { "0": [false, false] },
      },
    };

    const none = planAltModeCommands(
      {
        entity_number: 1,
        name: "assembling-machine-2",
        position: { x: 0.5, y: 0.5 },
      },
      am2,
      db,
    ).filter((c) => c.frame === 5 || c.frame === 6);
    expect(none).toHaveLength(0);

    const concrete = planAltModeCommands(
      {
        entity_number: 1,
        name: "assembling-machine-2",
        position: { x: 0.5, y: 0.5 },
        recipe: "concrete",
      },
      am2,
      db,
    ).filter((c) => c.frame === 5 || c.frame === 6);
    expect(concrete).toHaveLength(1);
    expect(concrete[0]!.frame).toBe(5);
    // Connection at [0,-1], then 1.25×size outward (north).
    expect(concrete[0]!.x).toBeCloseTo(0.5);
    expect(concrete[0]!.y).toBeCloseTo(-1.125);
    // Input facing north → arrow points into machine (180°)
    expect(concrete[0]!.rotation).toBe(180);
    expect(concrete[0]!.size).toBe(0.5);

    const acid = planAltModeCommands(
      {
        entity_number: 1,
        name: "assembling-machine-2",
        position: { x: 0.5, y: 0.5 },
        recipe: "sulfuric-acid",
      },
      am2,
      db,
    ).filter((c) => c.frame === 5 || c.frame === 6);
    expect(acid).toHaveLength(2);
    expect(acid.map((c) => c.rotation).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([180, 180]);
    // Output facing south (8): 8*22.5 = 180°, points outward south
    const output = acid.find((c) => c.y > 0.5)!;
    expect(output.x).toBeCloseTo(0.5);
    expect(output.y).toBeCloseTo(2.125);
    expect(output.rotation).toBe(180);
  });

  it("skips hidden fluid openings and uses both-ways sprite for input-output", () => {
    const { db } = fixture();
    Object.assign(db.icons, {
      "utility/fluid-indication-arrow": 5,
      "utility/fluid-indication-arrow-both-ways": 6,
    });
    db.iconScales = {
      ...db.iconScales,
      "utility/fluid-indication-arrow": 0.5,
      "utility/fluid-indication-arrow-both-ways": 0.5,
    };

    const pump: EntityRenderDef = {
      ...db.entities["assembling-machine-1"]!,
      kind: "simple",
      protoType: "pump",
      data: {
        fluidConnections: {
          "0": [
            [0, -1.5],
            [0, 1.5],
          ],
        },
        fluidConnectionRoles: { "0": ["input", "input"] },
        fluidConnectionFlows: { "0": ["output", "input"] },
        fluidConnectionFacings: { "0": [0, 8] },
        fluidConnectionHideInfo: { "0": [false, true] },
      },
    };
    const pumpArrows = planAltModeCommands(
      { entity_number: 1, name: "pump", position: { x: 0.5, y: 0.5 } },
      pump,
      db,
    ).filter((c) => c.frame === 5 || c.frame === 6);
    expect(pumpArrows).toHaveLength(1);
    expect(pumpArrows[0]!.frame).toBe(5);
    expect(pumpArrows[0]!.rotation).toBe(0);
    expect(pumpArrows[0]!.y).toBeCloseTo(-0.625);

    const boiler: EntityRenderDef = {
      ...db.entities["assembling-machine-1"]!,
      kind: "simple",
      protoType: "boiler",
      data: {
        fluidConnections: {
          "0": [
            [-2, 0.5],
            [2, 0.5],
            [0, -1.5],
          ],
        },
        fluidConnectionRoles: { "0": ["input", "input", "output"] },
        fluidConnectionFlows: { "0": ["input-output", "input-output", "output"] },
        fluidConnectionFacings: { "0": [12, 4, 0] },
        fluidConnectionHideInfo: { "0": [false, false, false] },
      },
    };
    const boilerArrows = planAltModeCommands(
      { entity_number: 2, name: "boiler", position: { x: 0, y: 0 } },
      boiler,
      db,
    ).filter((c) => c.frame === 5 || c.frame === 6);
    expect(boilerArrows).toHaveLength(3);
    const bothWays = boilerArrows.filter((c) => c.frame === 6);
    expect(bothWays).toHaveLength(2);
    expect(bothWays.map((c) => c.rotation).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([90, 270]);
  });

  it("does not draw fluid arrows on pipes or storage tanks", () => {
    const { db } = fixture();
    Object.assign(db.icons, {
      "utility/fluid-indication-arrow": 5,
      "utility/fluid-indication-arrow-both-ways": 6,
    });
    db.iconScales = {
      ...db.iconScales,
      "utility/fluid-indication-arrow": 0.5,
      "utility/fluid-indication-arrow-both-ways": 0.5,
    };
    const fluidData = {
      fluidConnections: { "0": [[0, -1]] as [number, number][] },
      fluidConnectionFlows: { "0": ["input-output" as const] },
      fluidConnectionFacings: { "0": [0] },
      fluidConnectionHideInfo: { "0": [false] },
    };
    for (const [kind, protoType] of [
      ["pipe", "pipe"],
      ["simple", "pipe-to-ground"],
      ["simple", "storage-tank"],
    ] as const) {
      const def: EntityRenderDef = {
        ...db.entities["assembling-machine-1"]!,
        kind,
        protoType,
        data: fluidData,
      };
      const arrows = planAltModeCommands(
        { entity_number: 1, name: protoType, position: { x: 0, y: 0 } },
        def,
        db,
      ).filter((c) => c.frame === 5 || c.frame === 6);
      expect(arrows).toHaveLength(0);
    }
  });
});
