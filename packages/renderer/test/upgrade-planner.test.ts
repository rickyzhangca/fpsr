import { describe, expect, it } from "vite-plus/test";
import {
  UPGRADE_PLANNER_SLOT_COUNT,
  upgradePlannerIcons,
  upgradePlannerMappers,
} from "../src/upgrade-planner.js";

/** Shape from fixtures/demos-style export (temp5.txt). */
const TEMP5_PLANNER = {
  item: "upgrade-planner",
  version: 562954249109505,
  settings: {
    mappers: [
      {
        from: {
          type: "entity",
          name: "underground-belt",
          quality: "normal",
          comparator: "=",
        },
        to: { type: "entity", name: "express-underground-belt" },
        index: 0,
      },
      {
        from: {
          type: "entity",
          name: "storage-tank",
          quality: "normal",
          comparator: "=",
        },
        to: { type: "entity", name: "storage-tank" },
        index: 1,
      },
      {
        from: {
          type: "entity",
          name: "transport-belt",
          quality: "normal",
          comparator: "=",
        },
        to: { type: "entity", name: "fast-transport-belt" },
        index: 2,
      },
      {
        from: { type: "entity", name: "pipe", quality: "normal", comparator: "=" },
        to: { type: "entity", name: "pipe" },
        index: 4,
      },
      {
        from: {
          type: "entity",
          name: "express-transport-belt",
          quality: "normal",
          comparator: "=",
        },
        to: { type: "entity", name: "transport-belt" },
        index: 5,
      },
    ],
  },
};

describe("upgradePlannerMappers", () => {
  it("expands sparse mappers into 24 slots keyed by index", () => {
    const slots = upgradePlannerMappers(TEMP5_PLANNER);
    expect(slots).toHaveLength(UPGRADE_PLANNER_SLOT_COUNT);
    expect(slots[0]?.from?.name).toBe("underground-belt");
    expect(slots[0]?.to?.name).toBe("express-underground-belt");
    expect(slots[1]?.from?.name).toBe("storage-tank");
    expect(slots[2]?.from?.name).toBe("transport-belt");
    expect(slots[3]).toBeUndefined();
    expect(slots[4]?.from?.name).toBe("pipe");
    expect(slots[5]?.from?.name).toBe("express-transport-belt");
    expect(slots[6]).toBeUndefined();
  });

  it("returns empty slots when settings or mappers are missing", () => {
    expect(upgradePlannerMappers({})).toEqual(Array(UPGRADE_PLANNER_SLOT_COUNT).fill(undefined));
    expect(upgradePlannerMappers({ settings: {} })).toEqual(
      Array(UPGRADE_PLANNER_SLOT_COUNT).fill(undefined),
    );
  });

  it("ignores out-of-range and invalid mapper entries", () => {
    const slots = upgradePlannerMappers({
      settings: {
        mappers: [
          { index: 0, from: { name: "a" }, to: { name: "b" } },
          { index: 24, from: { name: "too-high" } },
          { index: -1, from: { name: "neg" } },
          { from: { name: "no-index" } },
          "bad",
        ],
      },
    });
    expect(slots[0]?.from?.name).toBe("a");
    expect(slots.every((slot, i) => i === 0 || slot === undefined)).toBe(true);
  });

  it("keeps the last mapper when indices collide", () => {
    const slots = upgradePlannerMappers({
      settings: {
        mappers: [
          { index: 0, from: { name: "first" } },
          { index: 0, from: { name: "second" } },
        ],
      },
    });
    expect(slots[0]?.from?.name).toBe("second");
  });
});

describe("upgradePlannerIcons", () => {
  it("uses the to side of the first four filled mapper pairs", () => {
    expect(upgradePlannerIcons(TEMP5_PLANNER)).toEqual([
      { index: 1, signal: { name: "express-underground-belt", type: "entity" } },
      { index: 2, signal: { name: "storage-tank", type: "entity" } },
      { index: 3, signal: { name: "fast-transport-belt", type: "entity" } },
      { index: 4, signal: { name: "pipe", type: "entity" } },
    ]);
  });

  it("prefers an explicit icons field when present", () => {
    expect(
      upgradePlannerIcons({
        ...TEMP5_PLANNER,
        icons: [{ index: 1, signal: { type: "item", name: "iron-plate" } }],
      }),
    ).toEqual([{ index: 1, signal: { type: "item", name: "iron-plate" } }]);
  });

  it("returns an empty list when there are no mappers or icons", () => {
    expect(upgradePlannerIcons({ settings: {} })).toEqual([]);
  });
});
