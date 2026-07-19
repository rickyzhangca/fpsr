import { describe, expect, it } from "vite-plus/test";
import {
  DECONSTRUCTION_ENTITY_FILTER_SLOT_COUNT,
  DECONSTRUCTION_TILE_FILTER_SLOT_COUNT,
  deconstructionEntityFilterMode,
  deconstructionEntityFilters,
  deconstructionPlannerIcons,
  deconstructionTileFilterMode,
  deconstructionTileFilters,
  deconstructionTileSelectionMode,
  deconstructionTreesAndRocksOnly,
  formatDeconstructionFilterMode,
  formatDeconstructionTileSelectionMode,
} from "../src/deconstruction-planner.js";

/** Entry 0 from fixtures/demos/deconstruction-planners.bp.txt */
const BLACKLIST_NEVER = {
  item: "deconstruction-planner",
  version: 562954249109505,
  settings: {
    entity_filter_mode: 1,
    entity_filters: [
      { name: "storage-tank", quality: "normal", comparator: "=", index: 0 },
      { name: "burner-inserter", quality: "normal", comparator: "=", index: 1 },
    ],
    tile_selection_mode: 2,
  },
};

/** Entry 2: trees/rocks + tile filters */
const TREES_AND_TILES = {
  item: "deconstruction-planner",
  version: 562954249109505,
  settings: {
    entity_filters: [{ name: "storage-tank", quality: "normal", comparator: "=", index: 0 }],
    trees_and_rocks_only: true,
    tile_filters: [
      { name: "stone-path", index: 0 },
      { name: "hazard-concrete-left", index: 1 },
    ],
  },
};

describe("deconstructionEntityFilters / tileFilters", () => {
  it("expands sparse filters into fixed slots keyed by index", () => {
    const entities = deconstructionEntityFilters(BLACKLIST_NEVER);
    expect(entities).toHaveLength(DECONSTRUCTION_ENTITY_FILTER_SLOT_COUNT);
    expect(entities[0]?.name).toBe("storage-tank");
    expect(entities[1]?.name).toBe("burner-inserter");
    expect(entities[2]).toBeUndefined();

    const tiles = deconstructionTileFilters(TREES_AND_TILES);
    expect(tiles).toHaveLength(DECONSTRUCTION_TILE_FILTER_SLOT_COUNT);
    expect(tiles[0]?.name).toBe("stone-path");
    expect(tiles[1]?.name).toBe("hazard-concrete-left");
  });

  it("returns empty slots when settings are missing", () => {
    expect(deconstructionEntityFilters({})).toEqual(
      Array(DECONSTRUCTION_ENTITY_FILTER_SLOT_COUNT).fill(undefined),
    );
    expect(deconstructionTileFilters({ settings: {} })).toEqual(
      Array(DECONSTRUCTION_TILE_FILTER_SLOT_COUNT).fill(undefined),
    );
  });

  it("ignores out-of-range indices and keeps the last duplicate", () => {
    const entities = deconstructionEntityFilters({
      settings: {
        entity_filters: [
          { index: 0, name: "first" },
          { index: 0, name: "second" },
          { index: 30, name: "too-high" },
          { name: "no-index" },
        ],
      },
    });
    expect(entities[0]?.name).toBe("second");
    expect(entities.every((slot, i) => i === 0 || slot === undefined)).toBe(true);
  });
});

describe("deconstruction mode helpers", () => {
  it("reads filter and tile selection modes with Factorio defaults", () => {
    expect(deconstructionEntityFilterMode(BLACKLIST_NEVER)).toBe("blacklist");
    expect(deconstructionTileFilterMode(BLACKLIST_NEVER)).toBe("whitelist");
    expect(deconstructionTileSelectionMode(BLACKLIST_NEVER)).toBe("never");
    expect(deconstructionTreesAndRocksOnly(BLACKLIST_NEVER)).toBe(false);

    expect(deconstructionEntityFilterMode(TREES_AND_TILES)).toBe("whitelist");
    expect(deconstructionTileSelectionMode(TREES_AND_TILES)).toBe("normal");
    expect(deconstructionTreesAndRocksOnly(TREES_AND_TILES)).toBe(true);
  });

  it("formats mode labels for canvas text", () => {
    expect(formatDeconstructionFilterMode("whitelist")).toBe("Whitelist");
    expect(formatDeconstructionFilterMode("blacklist")).toBe("Blacklist");
    expect(formatDeconstructionTileSelectionMode("normal")).toBe("Normal");
    expect(formatDeconstructionTileSelectionMode("always")).toBe("Always");
    expect(formatDeconstructionTileSelectionMode("never")).toBe("Never");
    expect(formatDeconstructionTileSelectionMode("only")).toBe("Only");
  });
});

describe("deconstructionPlannerIcons", () => {
  it("uses tree-01 when trees_and_rocks_only is set", () => {
    expect(deconstructionPlannerIcons(TREES_AND_TILES)).toEqual([
      { index: 1, signal: { name: "tree-01", type: "entity" } },
    ]);
  });

  it("uses entity filters then tile filters up to four icons", () => {
    expect(
      deconstructionPlannerIcons({
        settings: {
          entity_filters: [{ name: "storage-tank", quality: "normal", comparator: "=", index: 0 }],
          tile_filters: [
            { name: "stone-path", index: 0 },
            { name: "hazard-concrete-left", index: 1 },
          ],
        },
      }),
    ).toEqual([
      { index: 1, signal: { name: "storage-tank", type: "entity" } },
      { index: 2, signal: { name: "stone-path", type: "tile" } },
      { index: 3, signal: { name: "hazard-concrete-left", type: "tile" } },
    ]);
  });

  it("prefers an explicit icons field when present", () => {
    expect(
      deconstructionPlannerIcons({
        ...BLACKLIST_NEVER,
        icons: [{ index: 1, signal: { type: "item", name: "iron-plate" } }],
      }),
    ).toEqual([{ index: 1, signal: { type: "item", name: "iron-plate" } }]);
  });
});
