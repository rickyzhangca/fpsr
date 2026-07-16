import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { discoverPlaceableEntities, discoverTilePlacingItems } from "../src/discover.js";
import { getPipelinePaths } from "../src/paths.js";
import type { DataRaw } from "../src/types.js";

describe("discoverTilePlacingItems", () => {
  it("maps tile prototypes to placing items, including hazard right siblings", () => {
    const raw: DataRaw = {
      item: {
        "stone-brick": { place_as_tile: { result: "stone-path" } },
        "hazard-concrete": { place_as_tile: { result: "hazard-concrete-left" } },
        concrete: { place_as_tile: { result: "concrete" } },
      },
      tile: {
        "stone-path": {},
        "hazard-concrete-left": {},
        "hazard-concrete-right": {},
        concrete: {},
      },
    };

    expect(discoverTilePlacingItems(raw)).toEqual({
      "stone-path": "stone-brick",
      "hazard-concrete-left": "hazard-concrete",
      "hazard-concrete-right": "hazard-concrete",
      concrete: "concrete",
    });
  });

  it("maps base-game logistics tiles from the data dump", async () => {
    const raw = JSON.parse(await readFile(getPipelinePaths().dumpPath, "utf8")) as DataRaw;
    const map = discoverTilePlacingItems(raw);
    expect(map["stone-path"]).toBe("stone-brick");
    expect(map["hazard-concrete-left"]).toBe("hazard-concrete");
    expect(map["hazard-concrete-right"]).toBe("hazard-concrete");
    expect(map["refined-hazard-concrete-left"]).toBe("refined-hazard-concrete");
    expect(map["refined-hazard-concrete-right"]).toBe("refined-hazard-concrete");
  });
});

describe("discoverPlaceableEntities", () => {
  it("includes Factorio 2.x legacy rail prototypes for blueprint rendering", async () => {
    const raw = JSON.parse(await readFile(getPipelinePaths().dumpPath, "utf8")) as DataRaw;
    const names = new Set(discoverPlaceableEntities(raw).map((e) => e.name));
    expect(names.has("legacy-straight-rail")).toBe(true);
    expect(names.has("legacy-curved-rail")).toBe(true);
    expect(names.has("straight-rail")).toBe(true);
  });
});
