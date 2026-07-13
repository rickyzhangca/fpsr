import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { discoverPlaceableEntities } from "../src/discover.js";
import { DUMP_PATH } from "../src/paths.js";
import type { DataRaw } from "../src/types.js";

describe("discoverPlaceableEntities", () => {
  it("includes Factorio 2.x legacy rail prototypes for blueprint rendering", async () => {
    const raw = JSON.parse(await readFile(DUMP_PATH, "utf8")) as DataRaw;
    const names = new Set(discoverPlaceableEntities(raw).map((e) => e.name));
    expect(names.has("legacy-straight-rail")).toBe(true);
    expect(names.has("legacy-curved-rail")).toBe(true);
    expect(names.has("straight-rail")).toBe(true);
  });
});
