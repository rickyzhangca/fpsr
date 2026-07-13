import { describe, expect, it } from "vite-plus/test";
import {
  type DrawCmd,
  type DrawList,
  compareDrawCmd,
  FACTORIO_RENDER_LAYERS,
  serializeDrawList,
} from "../src/types/draw-list.js";

/** Official order from https://lua-api.factorio.com/latest/types/RenderLayer.html (2.1.9). */
const OFFICIAL_RENDER_LAYERS = [
  "zero",
  "background-transitions",
  "under-tiles",
  "decals",
  "above-tiles",
  "ground-layer-1",
  "ground-layer-2",
  "ground-layer-3",
  "ground-layer-4",
  "ground-layer-5",
  "lower-radius-visualization",
  "radius-visualization",
  "transport-belt-integration",
  "resource",
  "building-smoke",
  "rail-stone-path-lower",
  "rail-stone-path",
  "rail-tie",
  "decorative",
  "ground-patch",
  "ground-patch-higher",
  "ground-patch-higher2",
  "rail-chain-signal-metal",
  "rail-screw",
  "rail-metal",
  "remnants",
  "floor",
  "transport-belt",
  "transport-belt-endings",
  "floor-mechanics-under-corpse",
  "corpse",
  "floor-mechanics",
  "item",
  "transport-belt-reader",
  "lower-object",
  "transport-belt-circuit-connector",
  "lower-object-above-shadow",
  "lower-object-overlay",
  "object-under",
  "object",
  "cargo-hatch",
  "higher-object-under",
  "higher-object-above",
  "train-stop-top",
  "item-in-inserter-hand",
  "above-inserters",
  "wires",
  "under-elevated",
  "elevated-rail-stone-path-lower",
  "elevated-rail-stone-path",
  "elevated-rail-tie",
  "elevated-rail-screw",
  "elevated-rail-metal",
  "elevated-lower-object",
  "elevated-object",
  "elevated-higher-object",
  "fluid-visualization",
  "wires-above",
  "entity-info-icon",
  "entity-info-icon-above",
  "explosion",
  "projectile",
  "smoke",
  "air-object",
  "air-entity-info-icon",
  "light-effect",
  "selection-box",
  "higher-selection-box",
  "collision-selection-box",
  "arrow",
  "cursor",
] as const;

describe("FACTORIO_RENDER_LAYERS", () => {
  it("includes every official RenderLayer with matching index", () => {
    expect(Object.keys(FACTORIO_RENDER_LAYERS)).toHaveLength(OFFICIAL_RENDER_LAYERS.length);
    for (const [i, name] of OFFICIAL_RENDER_LAYERS.entries()) {
      expect(FACTORIO_RENDER_LAYERS[name]).toBe(i);
    }
  });
});

describe("compareDrawCmd", () => {
  const base = (overrides: Partial<DrawCmd>): DrawCmd =>
    ({
      kind: "rect",
      layer: 50,
      sortY: 0,
      sortX: 0,
      entity: 0,
      sub: 0,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      color: [0, 0, 0, 1],
      ...overrides,
    }) as DrawCmd;

  it("sorts by layer first", () => {
    const a = base({ layer: 10 });
    const b = base({ layer: 70 });
    expect(compareDrawCmd(a, b)).toBeLessThan(0);
    expect(compareDrawCmd(b, a)).toBeGreaterThan(0);
  });

  it("sorts by sortY when layer ties", () => {
    const a = base({ layer: 70, sortY: 1.5 });
    const b = base({ layer: 70, sortY: 3.2 });
    expect(compareDrawCmd(a, b)).toBeLessThan(0);
  });

  it("sorts by sortX when layer and sortY tie", () => {
    const a = base({ layer: 70, sortY: 1, sortX: 0.5, entity: 10 });
    const b = base({ layer: 70, sortY: 1, sortX: 1.5, entity: 1 });
    expect(compareDrawCmd(a, b)).toBeLessThan(0);
  });

  it("sorts by entity when layer, sortY, and sortX tie", () => {
    const a = base({ layer: 70, sortY: 1, sortX: 0, entity: 1 });
    const b = base({ layer: 70, sortY: 1, sortX: 0, entity: 5 });
    expect(compareDrawCmd(a, b)).toBeLessThan(0);
  });

  it("sorts by sub when layer, sortY, sortX, and entity tie", () => {
    const a = base({ layer: 70, sortY: 1, sortX: 0, entity: 1, sub: 0 });
    const b = base({ layer: 70, sortY: 1, sortX: 0, entity: 1, sub: 2 });
    expect(compareDrawCmd(a, b)).toBeLessThan(0);
  });
});

describe("serializeDrawList", () => {
  it("produces stable output with rounded numbers and sorted keys", () => {
    const list: DrawList = {
      schema: 1,
      bounds: { minX: 0.123456, minY: 0, maxX: 1.99999, maxY: 2.00001 },
      commands: [
        {
          kind: "rect",
          layer: 50,
          sortY: 0,
          sortX: 0,
          entity: 0,
          sub: 0,
          x: 0.123456789,
          y: 0,
          w: 1,
          h: 1.000049,
          color: [0.1, 0.2, 0.3, 1],
        },
        {
          kind: "sprite",
          layer: 70,
          sortY: 2.5,
          sortX: 0,
          entity: 3,
          sub: 1,
          frame: 42,
          x: 1.5,
          y: 2.5,
          w: 0.5,
          h: 0.5,
          tint: [1, 1, 1, 0.5],
        },
      ],
    };

    const serialized = serializeDrawList(list);
    expect(serialized).toBe(
      [
        "{",
        '"schema": 1,',
        '"bounds": {"maxX":2,"maxY":2,"minX":0.1235,"minY":0},',
        '"commands": [',
        '{"color":[0.1,0.2,0.3,1],"entity":0,"h":1,"kind":"rect","layer":50,"sortX":0,"sortY":0,"sub":0,"w":1,"x":0.1235,"y":0},',
        '{"entity":3,"frame":42,"h":0.5,"kind":"sprite","layer":70,"sortX":0,"sortY":2.5,"sub":1,"tint":[1,1,1,0.5],"w":0.5,"x":1.5,"y":2.5}',
        "]",
        "}",
        "",
      ].join("\n"),
    );
  });
});
