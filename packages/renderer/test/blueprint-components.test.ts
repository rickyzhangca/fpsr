import { describe, expect, it } from "vite-plus/test";
import { countBlueprintComponents } from "../src/blueprint-components.js";
import type { Blueprint } from "../src/types/blueprint.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

function bp(partial: Partial<Blueprint> = {}): Blueprint {
  return { item: "blueprint", version: 2 * 2 ** 48, ...partial };
}

function bp1x(partial: Partial<Blueprint> = {}): Blueprint {
  return { item: "blueprint", version: 1 * 2 ** 48, ...partial };
}

describe("countBlueprintComponents", () => {
  const db = makeMiniDb();
  db.tiles["hazard-concrete-left"] = {
    layer: "ground-tile",
    item: "hazard-concrete",
    color: [0.8, 0.7, 0.2, 1],
  };
  db.tiles["hazard-concrete-right"] = {
    layer: "ground-tile",
    item: "hazard-concrete",
    color: [0.8, 0.7, 0.2, 1],
  };
  db.tiles["refined-concrete"] = {
    layer: "ground-tile",
    color: [0.5, 0.5, 0.5, 1],
  };

  it("merges modern and legacy rail pieces under rail", () => {
    expect(
      countBlueprintComponents(
        bp({
          entities: [
            { entity_number: 1, name: "straight-rail", position: { x: 0, y: 0 } },
            { entity_number: 2, name: "curved-rail-a", position: { x: 1, y: 0 } },
            { entity_number: 3, name: "curved-rail-b", position: { x: 2, y: 0 } },
            { entity_number: 4, name: "half-diagonal-rail", position: { x: 3, y: 0 } },
            { entity_number: 5, name: "legacy-straight-rail", position: { x: 4, y: 0 } },
            { entity_number: 6, name: "legacy-curved-rail", position: { x: 5, y: 0 } },
            { entity_number: 7, name: "straight-rail", position: { x: 6, y: 0 } },
          ],
        }),
        db,
      ),
    ).toEqual([{ name: "rail", count: 7 }]);
  });

  it("keeps non-rail entities separate when merging rails", () => {
    expect(
      countBlueprintComponents(
        bp({
          entities: [
            { entity_number: 1, name: "straight-rail", position: { x: 0, y: 0 } },
            { entity_number: 2, name: "legacy-curved-rail", position: { x: 1, y: 0 } },
            { entity_number: 3, name: "rail-signal", position: { x: 2, y: 0 } },
            { entity_number: 4, name: "elevated-straight-rail", position: { x: 3, y: 0 } },
          ],
        }),
        db,
      ),
    ).toEqual([
      { name: "rail", count: 2 },
      { name: "elevated-straight-rail", count: 1 },
      { name: "rail-signal", count: 1 },
    ]);
  });

  it("counts tiles alongside entities", () => {
    expect(
      countBlueprintComponents(
        bp({
          entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
          tiles: [
            { name: "refined-concrete", position: { x: 0, y: 0 } },
            { name: "refined-concrete", position: { x: 1, y: 0 } },
          ],
        }),
        db,
      ),
    ).toEqual([
      { name: "refined-concrete", count: 2 },
      { name: "wooden-chest", count: 1 },
    ]);
  });

  it("merges hazard-concrete left/right tiles by placing item", () => {
    expect(
      countBlueprintComponents(
        bp({
          tiles: [
            { name: "hazard-concrete-left", position: { x: 0, y: 0 } },
            { name: "hazard-concrete-right", position: { x: 1, y: 0 } },
            { name: "hazard-concrete-left", position: { x: 2, y: 0 } },
          ],
        }),
        db,
      ),
    ).toEqual([{ name: "hazard-concrete", count: 3 }]);
  });

  it("remaps stone-path to stone-brick via placing item", () => {
    expect(
      countBlueprintComponents(
        bp({
          tiles: [
            { name: "stone-path", position: { x: 0, y: 0 } },
            { name: "stone-path", position: { x: 1, y: 0 } },
          ],
        }),
        db,
      ),
    ).toEqual([{ name: "stone-brick", count: 2 }]);
  });

  it("keeps tile prototype name when no placing-item entry", () => {
    expect(
      countBlueprintComponents(
        bp({
          tiles: [{ name: "refined-concrete", position: { x: 0, y: 0 } }],
        }),
        db,
      ),
    ).toEqual([{ name: "refined-concrete", count: 1 }]);
  });

  it("sorts by count descending then name ascending", () => {
    expect(
      countBlueprintComponents(
        bp({
          entities: [
            { entity_number: 1, name: "inserter", position: { x: 0, y: 0 } },
            { entity_number: 2, name: "transport-belt", position: { x: 1, y: 0 } },
            { entity_number: 3, name: "transport-belt", position: { x: 2, y: 0 } },
            { entity_number: 4, name: "assembling-machine-2", position: { x: 3, y: 0 } },
          ],
        }),
        db,
      ),
    ).toEqual([
      { name: "transport-belt", count: 2 },
      { name: "assembling-machine-2", count: 1 },
      { name: "inserter", count: 1 },
    ]);
  });

  it("renames 1.x entities so component icons match 2.x item keys", () => {
    expect(
      countBlueprintComponents(
        bp1x({
          entities: [
            { entity_number: 1, name: "curved-rail", position: { x: 0, y: 0 } },
            { entity_number: 2, name: "straight-rail", position: { x: 1, y: 0 } },
            { entity_number: 3, name: "filter-inserter", position: { x: 0.5, y: 0.5 } },
            { entity_number: 4, name: "stack-inserter", position: { x: 1.5, y: 0.5 } },
            { entity_number: 5, name: "logistic-chest-requester", position: { x: 2.5, y: 0.5 } },
            { entity_number: 6, name: "logistic-chest-storage", position: { x: 3.5, y: 0.5 } },
          ],
        }),
        db,
      ),
    ).toEqual([
      { name: "rail", count: 2 },
      { name: "bulk-inserter", count: 1 },
      { name: "fast-inserter", count: 1 },
      { name: "requester-chest", count: 1 },
      { name: "storage-chest", count: 1 },
    ]);
  });
});
