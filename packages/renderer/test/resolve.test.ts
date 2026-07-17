import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  artilleryCannonShift,
  BELT_CURVE_LEFT,
  BELT_CURVE_RIGHT,
  BELT_END_INDEX,
  BELT_READER_BAND,
  BELT_READER_FRAME,
  BELT_START_INDEX,
  BELT_STRAIGHT_INDEX,
  beltCircuitConnectorFrame,
  beltCircuitConnectorVariation,
  beltConnectorBackPatchIndex,
  beltReaderSlots,
  buildBeltTileIndex,
  collectBeltReaderEntities,
  dir16ToIndex,
  railDirectionIndex,
  resolve,
  trainOrientationIndex,
  trainWheelShifts,
} from "../src/resolve.js";
import type { Blueprint, BlueprintEntity } from "../src/types/blueprint.js";
import type { RenderDb } from "../src/types/render-db.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_DB = JSON.parse(
  readFileSync(path.join(FIXTURE_ROOT, "fixtures/render-db/2.1.11.json"), "utf8"),
) as RenderDb;

function bp(entities: Blueprint["entities"]): Blueprint {
  return {
    item: "blueprint",
    version: 2 * 2 ** 48,
    entities,
  };
}

function bpLegacy(entities: Blueprint["entities"]): Blueprint {
  return {
    item: "blueprint",
    version: 1 * 2 ** 48,
    entities,
  };
}

describe("dir16ToIndex", () => {
  it("maps indexing modes", () => {
    expect(dir16ToIndex(0, "single")).toBe(0);
    expect(dir16ToIndex(12, "single")).toBe(0);
    expect(dir16ToIndex(0, "direction4")).toBe(0);
    expect(dir16ToIndex(4, "direction4")).toBe(1);
    expect(dir16ToIndex(8, "direction4")).toBe(2);
    expect(dir16ToIndex(12, "direction4")).toBe(3);
    expect(dir16ToIndex(6, "direction8")).toBe(3);
    expect(dir16ToIndex(15, "direction16")).toBe(15);
  });
});

describe("beltCircuitConnectorFrame", () => {
  const belt = (control_behavior?: BlueprintEntity["control_behavior"]): BlueprintEntity => ({
    entity_number: 1,
    name: "transport-belt",
    position: { x: 0.5, y: 0.5 },
    direction: 12,
    ...(control_behavior ? { control_behavior } : {}),
  });

  it("indexes the connector sheet by behavior state, independent of belt direction", () => {
    expect(beltCircuitConnectorFrame(belt())).toBe(0);
    expect(beltCircuitConnectorFrame(belt({ circuit_enabled: true }))).toBe(1);
    expect(beltCircuitConnectorFrame(belt({ circuit_read_hand_contents: true }))).toBe(2);
    expect(
      beltCircuitConnectorFrame(belt({ circuit_enabled: true, circuit_read_hand_contents: true })),
    ).toBe(3);
    expect(beltCircuitConnectorFrame(belt({ circuit_enable_disable: true }))).toBe(1);
  });
});

describe("resolve", () => {
  const db = makeMiniDb();

  it("skips unknown entities with a warning", () => {
    const warnings: string[] = [];
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 0.5, y: 0.5 },
        },
        {
          entity_number: 2,
          name: "no-such-thing",
          position: { x: 1.5, y: 0.5 },
        },
      ]),
      db,
      warnings,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.entity.name).toBe("wooden-chest");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no-such-thing/);
  });

  it("picks underground in/out variants", () => {
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "underground-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 4,
          type: "input",
        },
        {
          entity_number: 2,
          name: "underground-belt",
          position: { x: 2.5, y: 0.5 },
          direction: 4,
          type: "output",
        },
      ]),
      db,
    );
    expect(out[0]?.selections[0]?.variantKey).toBe("in");
    expect(out[1]?.selections[0]?.variantKey).toBe("out");
    expect(out[0]?.selections[0]?.index).toBe(1); // east input → structure column 1 (N,E,S,W sheet)
    expect(out[1]?.selections[0]?.index).toBe(3); // east output → opposite column (W)
  });

  it("flips inserter platform to drop side; hands keep pickup facing", () => {
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "inserter",
          position: { x: 0.5, y: 0.5 },
          direction: 4, // east = pickup east, drop west
        },
      ]),
      db,
    );
    const sels = out[0]?.selections ?? [];
    const platform = sels.find((s) => s.group === 0);
    const hands = sels.filter((s) => s.group > 0);
    // Platform sheet column = ((dir+8)%16)/4 → west (3) for east-facing inserter.
    expect(platform?.index).toBe(3);
    // Hand/arm layers keep entity facing (east = 1).
    for (const h of hands) {
      expect(h.index).toBe(1);
    }
  });

  it("computes pipe masks for a cross of 5 pipes", () => {
    const entities = [
      { entity_number: 1, name: "pipe", position: { x: 0.5, y: 0.5 } },
      { entity_number: 2, name: "pipe", position: { x: 0.5, y: -0.5 } },
      { entity_number: 3, name: "pipe", position: { x: 1.5, y: 0.5 } },
      { entity_number: 4, name: "pipe", position: { x: 0.5, y: 1.5 } },
      { entity_number: 5, name: "pipe", position: { x: -0.5, y: 0.5 } },
    ];
    const out = resolve(bp(entities), db);
    const byNum = new Map(out.map((r) => [r.entity.entity_number, r]));
    expect(byNum.get(1)?.selections[0]?.variantKey).toBe("1111");
    expect(byNum.get(2)?.selections[0]?.variantKey).toBe("0010");
    expect(byNum.get(3)?.selections[0]?.variantKey).toBe("0001");
    expect(byNum.get(4)?.selections[0]?.variantKey).toBe("1000");
    expect(byNum.get(5)?.selections[0]?.variantKey).toBe("0100");
  });

  it("computes wall corner mask", () => {
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "stone-wall",
          position: { x: 0.5, y: 0.5 },
        },
        {
          entity_number: 2,
          name: "stone-wall",
          position: { x: 1.5, y: 0.5 },
        },
        {
          entity_number: 3,
          name: "stone-wall",
          position: { x: 0.5, y: 1.5 },
        },
      ]),
      db,
    );
    const corner = out.find((r) => r.entity.entity_number === 1);
    expect(corner?.selections[0]?.variantKey).toBe("0110");
  });

  it("walls connect to adjacent gates", () => {
    const out = resolve(
      bp([
        { entity_number: 1, name: "stone-wall", position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: "gate", position: { x: 1.5, y: 0.5 }, direction: 0 },
        { entity_number: 3, name: "stone-wall", position: { x: 2.5, y: 0.5 } },
      ]),
      db,
    );
    const byNum = new Map(out.map((r) => [r.entity.entity_number, r]));
    expect(byNum.get(1)?.selections[0]?.variantKey).toBe("0100"); // E only
    expect(byNum.get(2)?.selections[0]?.variantKey).toBe("horizontal");
    expect(byNum.get(3)?.selections[0]?.variantKey).toBe("0001"); // W only
  });

  it("uses belt straight index per direction for isolated belts", () => {
    for (const dir of [0, 4, 8, 12] as const) {
      const out = resolve(
        bp([
          {
            entity_number: 1,
            name: "transport-belt",
            position: { x: 0.5, y: 0.5 },
            direction: dir,
          },
        ]),
        db,
        undefined,
        { beltEndings: false },
      );
      expect(out[0]?.selections[0]?.index).toBe(BELT_STRAIGHT_INDEX[dir]);
    }
  });

  it("emits starting and ending caps on an isolated belt", () => {
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 0,
        },
      ]),
      db,
    );
    const idxs = out[0]?.selections.map((s) => s.index) ?? [];
    expect(idxs).toContain(BELT_STRAIGHT_INDEX[0]);
    expect(idxs).toContain(BELT_START_INDEX[0]);
    expect(idxs).toContain(BELT_END_INDEX[0]);
    const start = out[0]?.selections.find((s) => s.index === BELT_START_INDEX[0]);
    expect(start?.shift).toEqual([0, 1]);
    const end = out[0]?.selections.find((s) => s.index === BELT_END_INDEX[0]);
    expect(end?.shift).toEqual([0, -1]);
  });

  it("curves a belt with a single perpendicular feeder", () => {
    // North-facing belt at (0.5,0.5); west belt at (-0.5,0.5) facing east → left curve.
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 0,
        },
        {
          entity_number: 2,
          name: "transport-belt",
          position: { x: -0.5, y: 0.5 },
          direction: 4,
        },
      ]),
      db,
      undefined,
      { beltEndings: false },
    );
    const north = out.find((r) => r.entity.entity_number === 1);
    expect(north?.selections[0]?.index).toBe(BELT_CURVE_LEFT[0]); // west_to_north
  });

  it("migrates Factorio 1.x directions at resolve entry so legacy west curves", () => {
    // 1.x dirs: 6=west at (0.5,0.5), feeder from south facing north (0).
    const out = resolve(
      bpLegacy([
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 6,
        },
        {
          entity_number: 2,
          name: "transport-belt",
          position: { x: 0.5, y: 1.5 },
          direction: 0,
        },
      ]),
      db,
      undefined,
      { beltEndings: false },
    );
    const west = out.find((r) => r.entity.entity_number === 1);
    expect(west?.entity.direction).toBe(12);
    expect(west?.selections[0]?.index).toBe(BELT_CURVE_LEFT[12]); // south_to_west
  });

  it("stays straight when sideloaded with a behind feeder", () => {
    // North-facing mid belt fed from behind AND from the side → straight (not curve).
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 0,
        },
        {
          entity_number: 2,
          name: "transport-belt",
          position: { x: 0.5, y: 1.5 },
          direction: 0, // behind, facing north into #1
        },
        {
          entity_number: 3,
          name: "transport-belt",
          position: { x: -0.5, y: 0.5 },
          direction: 4, // side feeder
        },
      ]),
      db,
      undefined,
      { beltEndings: false },
    );
    const mid = out.find((r) => r.entity.entity_number === 1);
    expect(mid?.selections[0]?.index).toBe(BELT_STRAIGHT_INDEX[0]);
  });

  it("curves all four corners of a 2x2 belt ring", () => {
    // 2x2 loop (smallest closed ring):
    // (0.5,0.5) east, (1.5,0.5) south, (1.5,1.5) west, (0.5,1.5) north
    const out = resolve(
      bp([
        { entity_number: 1, name: "transport-belt", position: { x: 0.5, y: 0.5 }, direction: 4 },
        { entity_number: 2, name: "transport-belt", position: { x: 1.5, y: 0.5 }, direction: 8 },
        { entity_number: 3, name: "transport-belt", position: { x: 1.5, y: 1.5 }, direction: 12 },
        { entity_number: 4, name: "transport-belt", position: { x: 0.5, y: 1.5 }, direction: 0 },
      ]),
      db,
      undefined,
      { beltEndings: false },
    );
    const byNum = new Map(out.map((r) => [r.entity.entity_number, r.selections[0]?.index]));
    // Each corner: sole feeder from behind-relative-right or left.
    // #1 east-facing, feeder from south (#4 is at west of #1... wait)
    // Ring clockwise:
    // #4 at (0.5,1.5) north → feeds #1 at (0.5,0.5)
    // #1 at (0.5,0.5) east → feeds #2 at (1.5,0.5)
    // #2 at (1.5,0.5) south → feeds #3 at (1.5,1.5)
    // #3 at (1.5,1.5) west → feeds #4 at (0.5,1.5)
    //
    // For #1 east-facing: behind=west, right=south, left=north.
    // Feeder #4 is south → right → curve right = south_to_east
    expect(byNum.get(1)).toBe(BELT_CURVE_RIGHT[4]);
    expect(byNum.get(2)).toBe(BELT_CURVE_RIGHT[8]);
    expect(byNum.get(3)).toBe(BELT_CURVE_RIGHT[12]);
    expect(byNum.get(4)).toBe(BELT_CURVE_RIGHT[0]);
  });

  it("connects pipes to boiler fluid openings", () => {
    // Boiler facing north at (0.5, 0); west pipe at boiler's west opening (-2, 0.5) → (-1.5, 0.5)
    const out = resolve(
      bp([
        { entity_number: 1, name: "boiler", position: { x: 0.5, y: 0 }, direction: 0 },
        { entity_number: 2, name: "pipe", position: { x: -1.5, y: 0.5 } },
      ]),
      db,
    );
    const pipeEnt = out.find((r) => r.entity.entity_number === 2);
    // Pipe should see a connection toward the boiler (east).
    expect(pipeEnt?.selections[0]?.variantKey).toBe("0100");
  });

  it("connects heat pipes to heat exchanger ports in every direction", () => {
    const cases = [
      { direction: 0, pipe: { x: 0, y: 1.5 }, mask: "1000" },
      { direction: 4, pipe: { x: -1.5, y: 0 }, mask: "0100" },
      { direction: 8, pipe: { x: 0, y: -1.5 }, mask: "0010" },
      { direction: 12, pipe: { x: 1.5, y: 0 }, mask: "0001" },
    ] as const;

    for (const { direction, pipe, mask } of cases) {
      const out = resolve(
        bp([
          {
            entity_number: 1,
            name: "heat-exchanger",
            position: { x: 0, y: 0 },
            direction,
          },
          { entity_number: 2, name: "heat-pipe", position: pipe },
        ]),
        FIXTURE_DB,
      );
      const heatPipe = out.find((r) => r.entity.entity_number === 2);
      expect(heatPipe?.selections[0]?.variantKey).toBe(mask);
    }
  });

  it("connects the facing heat-port patches of adjacent nuclear reactors", () => {
    const patchGroup =
      FIXTURE_DB.entities["nuclear-reactor"]?.data?.heatConnectionPatchGroupIndices?.[0];
    expect(patchGroup).toBeTypeOf("number");

    const out = resolve(
      bp([
        { entity_number: 1, name: "nuclear-reactor", position: { x: 0, y: 0 } },
        { entity_number: 2, name: "nuclear-reactor", position: { x: 5, y: 0 } },
        { entity_number: 3, name: "nuclear-reactor", position: { x: 0, y: 5 } },
        { entity_number: 4, name: "nuclear-reactor", position: { x: 5, y: 5 } },
      ]),
      FIXTURE_DB,
    );
    const patches = (entityNumber: number) =>
      out
        .find((entry) => entry.entity.entity_number === entityNumber)
        ?.selections.filter((selection) => selection.group === patchGroup) ?? [];
    const connectedPatchIndexes = (entityNumber: number) =>
      patches(entityNumber)
        .filter((selection) => selection.variantKey === "connected")
        .map((selection) => selection.index);

    for (const entityNumber of [1, 2, 3, 4]) expect(patches(entityNumber)).toHaveLength(12);
    expect(connectedPatchIndexes(1)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(connectedPatchIndexes(2)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(connectedPatchIndexes(3)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(connectedPatchIndexes(4)).toEqual([0, 1, 2, 9, 10, 11]);
  });
});

describe("trainOrientationIndex", () => {
  it("rounds orientation into pose indices", () => {
    expect(trainOrientationIndex(0, 64)).toBe(0);
    expect(trainOrientationIndex(0.25, 64)).toBe(16);
    expect(trainOrientationIndex(0.5, 64)).toBe(32);
    expect(trainOrientationIndex(0.75, 64)).toBe(48);
    expect(trainOrientationIndex(0.999, 64)).toBe(0); // rounds to 64 → % 64
    expect(trainOrientationIndex(1.25, 32)).toBe(8); // wraps fractional part
  });

  it("folds back_equals_front so east and west share a pose", () => {
    expect(trainOrientationIndex(0.25, 64, true)).toBe(32);
    expect(trainOrientationIndex(0.75, 64, true)).toBe(32);
    expect(trainOrientationIndex(0, 64, true)).toBe(0);
    expect(trainOrientationIndex(0.5, 64, true)).toBe(0);
  });
});

describe("vehicle orientation", () => {
  it("selects camera-projected 64-way poses without train geometry", () => {
    const db = makeMiniDb();
    const fallbackFrame = db.entities["wooden-chest"]?.graphics[0]?.variants.default?.[0]?.frame;
    expect(fallbackFrame).toBeTypeOf("number");
    db.entities.car = {
      kind: "vehicle",
      protoType: "car",
      collisionBox: [
        [-1, -1],
        [1, 1],
      ],
      selectionBox: [
        [-1, -1],
        [1, 1],
      ],
      graphics: [
        {
          layer: "object",
          indexing: "resolver",
          variants: {
            default: Array.from({ length: 64 }, () => ({
              frame: fallbackFrame as number,
              scale: 1,
              shift: [0, 0] as [number, number],
            })),
          },
        },
      ],
      data: { orientationCount: 64 },
    };

    const out = resolve(
      bp([{ entity_number: 1, name: "car", position: { x: 0, y: 0 }, orientation: 4 / 64 }]),
      db,
    );
    expect(out[0]?.selections[0]?.index).toBe(3);
  });
});

describe("artilleryCannonShift", () => {
  const opts = {
    cannonBaseHeight: 1.672049,
    cannonBaseShiftWhenVertical: -2.5357685,
    cannonBaseShiftWhenHorizontal: -2.0702245,
    orientationCount: 64,
  };

  it("offsets east-facing mount along -X with height flatten", () => {
    const [x, y] = artilleryCannonShift(0.25, opts);
    // Horizontal: offsetForward ≈ 2.070, rotation=π → cos=-1 → x ≈ -2.070
    expect(x).toBeCloseTo(-2.0702245, 4);
    // y = 0 * P - height * P
    expect(y).toBeCloseTo(-1.672049 * Math.SQRT1_2, 4);
  });

  it("uses vertical shift for north-facing mount", () => {
    const [x, y] = artilleryCannonShift(0, opts);
    // rotation=π/2 → cos=0, sin=1; offsetForward ≈ 2.536
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(2.5357685 * Math.SQRT1_2 - 1.672049 * Math.SQRT1_2, 4);
  });
});

describe("trainWheelShifts", () => {
  it("places two bogies at ±jointDistance/2 for east-facing stock", () => {
    const bogies = trainWheelShifts(0.25, 4);
    expect(bogies).toHaveLength(2);
    expect(bogies[0]!.shift[0]).toBeCloseTo(2, 5);
    expect(bogies[1]!.shift[0]).toBeCloseTo(-2, 5);
    // East: rail-shift Y is -0.25 (FBSR flatten of height 0.25).
    expect(bogies[0]!.shift[1]).toBeCloseTo(-0.25, 5);
    expect(bogies[1]!.shift[1]).toBeCloseTo(-0.25, 5);
    // Forward bogie faces outward (orientation+0.5); rear keeps body facing.
    expect(bogies[0]!.orientation).toBeCloseTo(0.75, 5);
    expect(bogies[1]!.orientation).toBeCloseTo(0.25, 5);
  });

  it("uses zero rail-shift Y for north-facing stock", () => {
    const bogies = trainWheelShifts(0, 4);
    expect(bogies[0]!.shift[0]).toBeCloseTo(0, 5);
    expect(bogies[0]!.shift[1]).toBeCloseTo(-2, 5); // -half joint, no rail shift
    expect(bogies[0]!.orientation).toBeCloseTo(0.5, 5);
    expect(bogies[1]!.orientation).toBeCloseTo(0, 5);
  });
});

describe("beltCircuitConnectorVariation", () => {
  it("maps straights to H/V and curves to SE/SW/NE/NW", () => {
    // Lone east-facing belt → H (1)
    const east = {
      entity_number: 1,
      name: "transport-belt",
      position: { x: 0.5, y: 0.5 },
      direction: 4,
    };
    let index = buildBeltTileIndex([east], FIXTURE_DB);
    expect(beltCircuitConnectorVariation(east, index)).toBe(1);
    expect(beltConnectorBackPatchIndex(1)).toBe(0);

    // Lone north-facing → V (2)
    const north = { ...east, direction: 0 };
    index = buildBeltTileIndex([north], FIXTURE_DB);
    expect(beltCircuitConnectorVariation(north, index)).toBe(2);

    // North-facing with feeder from east (right) → NE (5)
    const feeder = {
      entity_number: 2,
      name: "transport-belt",
      position: { x: 1.5, y: 0.5 },
      direction: 12, // west → faces toward north belt
    };
    index = buildBeltTileIndex([north, feeder], FIXTURE_DB);
    expect(beltCircuitConnectorVariation(north, index)).toBe(5);
    expect(beltConnectorBackPatchIndex(5)).toBe(2);
  });
});

describe("railDirectionIndex", () => {
  it("maps 16-way blueprint dirs to direction8 / folded-4", () => {
    expect(railDirectionIndex(0, false)).toBe(0); // north
    expect(railDirectionIndex(2, false)).toBe(1); // northeast
    expect(railDirectionIndex(4, false)).toBe(2); // east
    expect(railDirectionIndex(6, false)).toBe(3); // southeast
    expect(railDirectionIndex(8, false)).toBe(4); // south
    expect(railDirectionIndex(8, true)).toBe(0); // straight fold → north
    expect(railDirectionIndex(12, true)).toBe(2); // west fold → east
    expect(railDirectionIndex(15, false)).toBe(7); // floor(15/2)=7 northwest
    expect(railDirectionIndex(15, true)).toBe(3);
  });
});

describe("resolve (fixture render-db)", () => {
  it("indexes UG structure columns N,E,S,W while belt layer stays N,E,S,W", () => {
    const entities = [
      {
        entity_number: 1,
        name: "underground-belt",
        position: { x: 0.5, y: 0.5 },
        direction: 4,
        type: "input",
      },
      {
        entity_number: 2,
        name: "underground-belt",
        position: { x: 2.5, y: 0.5 },
        direction: 12,
        type: "output",
      },
    ] as Blueprint["entities"];
    const out = resolve(bp(entities), FIXTURE_DB);
    const graphics = FIXTURE_DB.entities["underground-belt"]?.graphics ?? [];
    const beltGroup = graphics.findIndex((g) => g.layer === "transport-belt");
    const objectGroup = graphics.findIndex((g) => g.layer === "object");

    const eastIn = out[0]?.selections.find((s) => s.group === objectGroup);
    const eastBelt = out[0]?.selections.find((s) => s.group === beltGroup);
    const westOut = out[1]?.selections.find((s) => s.group === objectGroup);
    const westBelt = out[1]?.selections.find((s) => s.group === beltGroup);

    expect(eastIn?.variantKey).toBe("in");
    expect(eastIn?.index).toBe(1);
    expect(eastBelt?.index).toBe(1);
    expect(westOut?.variantKey).toBe("out");
    expect(westOut?.index).toBe(1); // west output flips to east structure column
    expect(westBelt?.index).toBe(3);
  });

  it("faces paired UG endpoints away (same blueprint direction)", () => {
    const entities = [
      {
        entity_number: 1,
        name: "underground-belt",
        position: { x: 0.5, y: 0.5 },
        direction: 4,
        type: "input",
      },
      {
        entity_number: 2,
        name: "underground-belt",
        position: { x: 2.5, y: 0.5 },
        direction: 4,
        type: "output",
      },
    ] as Blueprint["entities"];
    const out = resolve(bp(entities), FIXTURE_DB);
    const graphics = FIXTURE_DB.entities["underground-belt"]?.graphics ?? [];
    const objectGroup = graphics.findIndex((g) => g.layer === "object");
    const eastIn = out[0]?.selections.find((s) => s.group === objectGroup);
    const eastOut = out[1]?.selections.find((s) => s.group === objectGroup);
    expect(eastIn?.index).toBe(1);
    expect(eastOut?.index).toBe(3);
    expect(eastIn?.index).not.toBe(eastOut?.index);
  });

  it("resolves east underground in/out to non-placeholder object frames", () => {
    const entities = [
      {
        entity_number: 1,
        name: "underground-belt",
        position: { x: 0.5, y: 0.5 },
        direction: 4,
        type: "input",
      },
      {
        entity_number: 2,
        name: "underground-belt",
        position: { x: 2.5, y: 0.5 },
        direction: 4,
        type: "output",
      },
    ] as Blueprint["entities"];
    const out = resolve(bp(entities), FIXTURE_DB);
    const objectGroup = FIXTURE_DB.entities["underground-belt"]?.graphics.find(
      (g) => g.layer === "object",
    );
    const northInFrame = objectGroup?.variants.in?.[0]?.frame;
    const eastInFrame = objectGroup?.variants.in?.[1]?.frame;
    const eastOutFrame = objectGroup?.variants.out?.[3]?.frame;

    const inSel = out[0]?.selections.find((s) => s.variantKey === "in");
    const outSel = out[1]?.selections.find((s) => s.variantKey === "out");
    expect(inSel?.index).toBe(1);
    expect(outSel?.index).toBe(3);
    expect(eastInFrame).not.toBe(712);
    expect(eastOutFrame).not.toBe(712);
    expect(eastOutFrame).not.toBe(northInFrame);
    expect(objectGroup?.variants.in?.[inSel?.index ?? -1]?.frame).toBe(eastInFrame);
    expect(objectGroup?.variants.out?.[outSel?.index ?? -1]?.frame).toBe(eastOutFrame);
  });

  it("emits UG open-side start cap even when a belt side-loads", () => {
    // North-facing UG input; east-facing belt on the west tile (side-load).
    // Open side is south — start cap must still emit (sides do not seal it).
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "underground-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 0,
          type: "input",
        },
        {
          entity_number: 2,
          name: "transport-belt",
          position: { x: -0.5, y: 0.5 },
          direction: 4,
        },
      ]),
      FIXTURE_DB,
    );
    const ug = out.find((r) => r.entity.entity_number === 1);
    const graphics = FIXTURE_DB.entities["underground-belt"]?.graphics ?? [];
    const beltGroup = graphics.findIndex((g) => g.layer === "transport-belt");
    const start = ug?.selections.find((s) => s.group === beltGroup && s.variantKey === "start");
    expect(start).toBeDefined();
    expect(start?.shift).toEqual([0, 1]);
  });

  it("suppresses UG start cap when a behind feeder seals the open side", () => {
    const out = resolve(
      bp([
        {
          entity_number: 1,
          name: "underground-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 0,
          type: "input",
        },
        {
          entity_number: 2,
          name: "transport-belt",
          position: { x: 0.5, y: 1.5 },
          direction: 0,
        },
      ]),
      FIXTURE_DB,
    );
    const ug = out.find((r) => r.entity.entity_number === 1);
    const graphics = FIXTURE_DB.entities["underground-belt"]?.graphics ?? [];
    const beltGroup = graphics.findIndex((g) => g.layer === "transport-belt");
    const start = ug?.selections.find((s) => s.group === beltGroup && s.variantKey === "start");
    expect(start).toBeUndefined();
  });

  it("resolves east splitters with structure and top patch frames", () => {
    const entities = [
      { entity_number: 1, name: "fast-splitter", position: { x: 0.5, y: 0.5 }, direction: 0 },
      { entity_number: 2, name: "fast-splitter", position: { x: 2.5, y: 0.5 }, direction: 4 },
    ] as Blueprint["entities"];
    const out = resolve(bp(entities), FIXTURE_DB);
    const graphics = FIXTURE_DB.entities["fast-splitter"]?.graphics ?? [];
    const structureIdx = graphics.findIndex(
      (g) =>
        g.layer === "object" && g.variants.default?.[0] != null && g.variants.default?.[1] != null,
    );
    const patchIdx = graphics.findIndex(
      (g) =>
        g.layer === "object-under" &&
        g.variants.default?.[0] == null &&
        g.variants.default?.[1] != null,
    );

    const northSel = out[0]?.selections.find((s) => s.group === structureIdx);
    const eastStructure = out[1]?.selections.find((s) => s.group === structureIdx);
    const eastPatch = out[1]?.selections.find((s) => s.group === patchIdx);
    expect(northSel?.index).toBe(0);
    expect(eastStructure?.index).toBe(1);
    expect(eastPatch?.index).toBe(1);
    expect(graphics[structureIdx]?.variants.default?.[eastStructure?.index ?? -1]?.frame).toBe(
      graphics[structureIdx]?.variants.default?.[1]?.frame,
    );
    expect(graphics[patchIdx]?.variants.default?.[eastPatch?.index ?? -1]?.frame).toBe(
      graphics[patchIdx]?.variants.default?.[1]?.frame,
    );
  });

  it("mirrors Ending caps past one-sided belt-reader termini", () => {
    // East-facing line: west tip at 0.5, middle at 1.5, east tip at 2.5.
    const entities: BlueprintEntity[] = [
      {
        entity_number: 1,
        name: "transport-belt",
        position: { x: 0.5, y: 0.5 },
        direction: 4,
      },
      {
        entity_number: 2,
        name: "transport-belt",
        position: { x: 1.5, y: 0.5 },
        direction: 4,
        control_behavior: {
          circuit_read_hand_contents: true,
          circuit_contents_read_mode: 2,
        },
      },
      {
        entity_number: 3,
        name: "transport-belt",
        position: { x: 2.5, y: 0.5 },
        direction: 4,
      },
    ];
    const blueprint = bp(entities);
    const beltIndex = buildBeltTileIndex(entities, FIXTURE_DB);
    const readers = collectBeltReaderEntities(blueprint, FIXTURE_DB, beltIndex);
    expect(readers.size).toBe(3);

    const west = beltReaderSlots(
      entities[0]!,
      FIXTURE_DB.entities["transport-belt"]!,
      beltIndex,
      readers,
    );
    const mid = beltReaderSlots(
      entities[1]!,
      FIXTURE_DB.entities["transport-belt"]!,
      beltIndex,
      readers,
    );
    const east = beltReaderSlots(
      entities[2]!,
      FIXTURE_DB.entities["transport-belt"]!,
      beltIndex,
      readers,
    );

    // Solid rails are not flipped — Ending mirror closes the fancy caps.
    expect(
      west.filter((s) => s.band === BELT_READER_BAND.solid).every((s) => !s.flipX && !s.flipY),
    ).toBe(true);
    expect(
      east.filter((s) => s.band === BELT_READER_BAND.solid).every((s) => !s.flipX && !s.flipY),
    ).toBe(true);
    expect(mid.every((s) => !s.flipX && !s.flipY)).toBe(true);
    expect(mid.some((s) => s.band === BELT_READER_BAND.ending)).toBe(false);

    // Ending: inward hook + mirrored outer half past the tip.
    expect(west.filter((s) => s.band === BELT_READER_BAND.ending)).toEqual([
      { band: BELT_READER_BAND.ending, frame: BELT_READER_FRAME.west },
      {
        band: BELT_READER_BAND.ending,
        frame: BELT_READER_FRAME.west,
        flipX: true,
        shift: [-1, 0],
      },
    ]);
    expect(east.filter((s) => s.band === BELT_READER_BAND.ending)).toEqual([
      { band: BELT_READER_BAND.ending, frame: BELT_READER_FRAME.east },
      {
        band: BELT_READER_BAND.ending,
        frame: BELT_READER_FRAME.east,
        flipX: true,
        shift: [1, 0],
      },
    ]);
  });
});
