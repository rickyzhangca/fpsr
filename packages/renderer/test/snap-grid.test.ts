import { describe, expect, it } from "vite-plus/test";
import { planDrawList } from "../src/plan.js";
import { snapGridRect } from "../src/snap-grid.js";
import type { Blueprint } from "../src/types/blueprint.js";
import { RENDER_LAYERS } from "../src/types/draw-list.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

function bp(partial: Partial<Blueprint>): Blueprint {
  return {
    item: "blueprint",
    version: 2 * 2 ** 48,
    ...partial,
  };
}

describe("snapGridRect", () => {
  it("returns null when snap-to-grid is missing or non-positive", () => {
    expect(snapGridRect(bp({}))).toBeNull();
    expect(snapGridRect(bp({ "snap-to-grid": { x: 0, y: 4 } }))).toBeNull();
    expect(snapGridRect(bp({ "snap-to-grid": { x: 4, y: -1 } }))).toBeNull();
  });

  it("places the rect at the blueprint origin", () => {
    expect(snapGridRect(bp({ "snap-to-grid": { x: 96, y: 96 } }))).toEqual({
      x: 0,
      y: 0,
      w: 96,
      h: 96,
    });
  });

  it("ignores position-relative-to-grid for the local preview box", () => {
    expect(
      snapGridRect(
        bp({
          "snap-to-grid": { x: 4, y: 3 },
          "position-relative-to-grid": { x: 10, y: 5 },
          "absolute-snapping": true,
        }),
      ),
    ).toEqual({ x: 0, y: 0, w: 4, h: 3 });
  });
});

describe("emitSnapGrid via planDrawList", () => {
  const db = makeMiniDb();

  it("emits a snap-grid command for snap-to-grid blueprints", () => {
    const list = planDrawList(
      bp({
        "snap-to-grid": { x: 4, y: 3 },
        entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
      }),
      db,
      { altMode: false },
    );
    const snap = list.commands.filter((c) => c.kind === "snap-grid");
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      kind: "snap-grid",
      layer: RENDER_LAYERS["selection-box"],
      x: 0,
      y: 0,
      w: 4,
      h: 3,
    });
    expect(list.bounds.minX).toBeLessThanOrEqual(0);
    expect(list.bounds.minY).toBeLessThanOrEqual(0);
    expect(list.bounds.maxX).toBeGreaterThanOrEqual(4);
    expect(list.bounds.maxY).toBeGreaterThanOrEqual(3);
  });

  it("omits snap-grid when snap metadata is absent", () => {
    const list = planDrawList(
      bp({
        entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
      }),
      db,
      { altMode: false },
    );
    expect(list.commands.some((c) => c.kind === "snap-grid")).toBe(false);
  });
});
