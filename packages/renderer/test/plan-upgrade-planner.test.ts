import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { planUpgradePlannerDrawList } from "../src/plan/upgrade-planner.js";
import { RENDER_LAYERS } from "../src/types/draw-list.js";
import type { RenderDb } from "../src/types/render-db.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const db = JSON.parse(
  readFileSync(path.join(ROOT, "fixtures/render-db/2.1.11.json"), "utf8"),
) as RenderDb;

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

describe("planUpgradePlannerDrawList", () => {
  it("plans a 4-column grid with from→arrow→to icons and empty slot 3", () => {
    const list = planUpgradePlannerDrawList(TEMP5_PLANNER, db);
    expect(list.schema).toBe(1);
    // 1-tile outer pad + 4×(3 icons) + 3 gaps = 17 wide.
    // temp5 max index 5 → 2 rows → height 1+2+1+1 = 5.
    expect(list.bounds).toEqual({ minX: 0, minY: 0, maxX: 17, maxY: 5 });

    const icons = list.commands.filter((cmd) => cmd.kind === "icon");
    // 5 filled slots × (from + arrow + to)
    expect(icons).toHaveLength(15);

    const entities = new Set(icons.map((cmd) => cmd.entity));
    expect(entities.has(4)).toBe(false); // empty index 3 → entity 4 absent
    expect(entities.has(1)).toBe(true); // index 0
    expect(entities.has(5)).toBe(true); // index 4
    expect(entities.has(6)).toBe(true); // index 5

    const slot0 = icons.filter((cmd) => cmd.entity === 1);
    expect(slot0).toHaveLength(3);
    const [from, arrow, to] = [...slot0].sort((a, b) => a.sub - b.sub);
    expect(from?.frame).toBe(db.icons["entity/underground-belt"]);
    expect(from?.silhouette).toBeUndefined();
    expect(from?.backing).toBeUndefined();
    expect(from?.backingFrame).toBeUndefined();
    expect(from?.size).toBe(1);
    expect(from?.x).toBe(1.5);
    expect(from?.y).toBe(1.5);
    expect(arrow?.frame).toBe(db.icons["virtual-signal/right-arrow"]);
    expect(arrow?.size).toBe(1);
    expect(arrow?.x).toBe(2.5);
    expect(arrow?.y).toBe(1.5);
    expect(arrow?.rotation).toBeUndefined();
    expect(to?.frame).toBe(db.icons["entity/express-underground-belt"]);
    expect(to?.x).toBe(3.5);
    expect(to?.y).toBe(1.5);
    expect(from?.layer).toBe(RENDER_LAYERS.icons);

    // Slot 1 is one gap tile past slot 0 (3 icons + 1 gap).
    const slot1 = icons.filter((cmd) => cmd.entity === 2);
    const slot1From = [...slot1].sort((a, b) => a.sub - b.sub)[0];
    expect(slot1From?.y).toBe(1.5);
    expect(slot1From?.x).toBe(5.5);

    // Slot 4 (index 4) is row 1, column 0 — one gap below row 0.
    const slot4 = icons.filter((cmd) => cmd.entity === 5);
    const slot4From = [...slot4].sort((a, b) => a.sub - b.sub)[0];
    expect(slot4From?.x).toBe(1.5);
    expect(slot4From?.y).toBe(3.5);
  });

  it("returns empty commands with pad-only bounds for an empty planner", () => {
    const list = planUpgradePlannerDrawList({ settings: { mappers: [] } }, db);
    expect(list.commands).toEqual([]);
    expect(list.bounds).toEqual({ minX: 0, minY: 0, maxX: 17, maxY: 2 });
  });

  it("sizes height from the last occupied row only", () => {
    const list = planUpgradePlannerDrawList(
      {
        settings: {
          mappers: [
            {
              index: 0,
              from: { type: "entity", name: "transport-belt" },
              to: { type: "entity", name: "fast-transport-belt" },
            },
          ],
        },
      },
      db,
    );
    // Single row: 1 + 1 + 1 = 3 tall.
    expect(list.bounds).toEqual({ minX: 0, minY: 0, maxX: 17, maxY: 3 });
  });
});
