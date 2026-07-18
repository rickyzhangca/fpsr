import type { Blueprint, DrawList, RenderDb } from "fpsr";
import { describe, expect, it } from "vite-plus/test";
import { analyzePlan } from "./plan-diagnostics";

const db = {
  entities: { "transport-belt": {} },
  tiles: { "stone-path": {} },
  frames: [{ a: 2 }],
} as unknown as RenderDb;

describe("analyzePlan", () => {
  it("reports unsupported content and draw-list evidence", () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
        },
        {
          entity_number: 2,
          name: "modded-chest",
          position: { x: 1.5, y: 0.5 },
        },
      ],
      tiles: [
        { name: "stone-path", position: { x: 0, y: 0 } },
        { name: "modded-floor", position: { x: 1, y: 0 } },
      ],
    };
    const drawList: DrawList = {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      commands: [
        {
          kind: "sprite",
          layer: 2,
          sortY: 0,
          sortX: 0,
          entity: 0,
          sub: 0,
          frame: 0,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
        },
      ],
    };

    expect(analyzePlan(blueprint, drawList, db)).toEqual({
      entities: {
        total: 2,
        resolved: 1,
        unsupported: [{ name: "modded-chest", count: 1, entityNumbers: [2] }],
      },
      tiles: {
        total: 2,
        resolved: 1,
        unsupported: [{ name: "modded-floor", count: 1 }],
      },
      drawList: {
        commandCount: 1,
        byKind: { sprite: 1 },
        uniqueFrames: 1,
        uniqueLayers: 1,
        atlasIndices: [2],
      },
      checks: {
        finiteBounds: true,
        finiteCommands: true,
        sortedCommands: true,
        validFrameReferences: true,
      },
    });
  });

  it("detects invalid geometry, order, and frame references", () => {
    const blueprint: Blueprint = { item: "blueprint", version: 2 * 2 ** 48 };
    const drawList: DrawList = {
      schema: 1,
      bounds: { minX: 2, minY: 0, maxX: 1, maxY: 1 },
      commands: [
        {
          kind: "sprite",
          layer: 4,
          sortY: 0,
          sortX: 0,
          entity: 1,
          sub: 0,
          frame: 99,
          x: Number.NaN,
          y: 0,
          w: 1,
          h: 1,
        },
        {
          kind: "rect",
          layer: 2,
          sortY: 0,
          sortX: 0,
          entity: 0,
          sub: 0,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          color: [0, 0, 0, 1],
        },
      ],
    };

    expect(analyzePlan(blueprint, drawList, db).checks).toEqual({
      finiteBounds: false,
      finiteCommands: false,
      sortedCommands: false,
      validFrameReferences: false,
    });
  });
});
