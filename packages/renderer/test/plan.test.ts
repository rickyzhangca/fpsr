import { describe, expect, it } from "vite-plus/test";
import { entityInfoSilhouettePadPx } from "../src/icon-silhouette.js";
import { normalizeEntityColor, planDrawList } from "../src/plan.js";
import type { Blueprint } from "../src/types/blueprint.js";
import type { SpriteCmd } from "../src/types/draw-list.js";
import { RENDER_LAYERS, serializeDrawList } from "../src/types/draw-list.js";
import { makeMiniDb } from "./fixtures/mini-db.js";

const db = makeMiniDb();

function bp(partial: Partial<Blueprint>): Blueprint {
  return {
    item: "blueprint",
    version: 2 * 2 ** 48,
    ...partial,
  };
}

describe("normalizeEntityColor", () => {
  it("keeps 0–1 channels and scales 0–255 exports", () => {
    expect(normalizeEntityColor({ r: 0.92, g: 0.07, b: 0, a: 1 })).toEqual([0.92, 0.07, 0, 1]);
    expect(normalizeEntityColor({ r: 242, g: 0, b: 0 })).toEqual([242 / 255, 0, 0, 1]);
  });
});

describe("planDrawList", () => {
  it("omits an unpainted vehicle runtime-color mask and tints it when colored", () => {
    const vehicleDb = structuredClone(db);
    const frame = vehicleDb.entities["wooden-chest"]!.graphics[0]!.variants.default![0]!.frame;
    vehicleDb.entities.car = {
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
          variants: { default: [{ frame, scale: 1, shift: [0, 0] }] },
        },
        {
          layer: "object",
          indexing: "resolver",
          variants: { default: [{ frame, scale: 1, shift: [0, 0] }] },
        },
      ],
      data: { orientationCount: 1, colorMaskGroupIndices: [1] },
    };
    const unpainted = planDrawList(
      bp({ entities: [{ entity_number: 1, name: "car", position: { x: 0, y: 0 } }] }),
      vehicleDb,
    );
    expect(unpainted.commands.filter((command) => command.kind === "sprite")).toHaveLength(1);

    const painted = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "car",
            position: { x: 0, y: 0 },
            color: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
          },
        ],
      }),
      vehicleDb,
    );
    const paintedSprites = painted.commands.filter(
      (command): command is SpriteCmd => command.kind === "sprite",
    );
    expect(paintedSprites).toHaveLength(2);
    expect(paintedSprites.find((command) => command.sub === 1)?.tint).toEqual([
      0.25, 0.5, 0.75, 1,
    ]);
  });

  it("computes dest rect from frame sw/sh/scale/shift", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "dest-math",
            position: { x: 10, y: 20 },
          },
        ],
      }),
      db,
    );
    const sprite = list.commands.find((c) => c.kind === "sprite") as SpriteCmd;
    // w = 32*0.5/32 = 0.5; center = (10+0.25, 20-0.125) = (10.25, 19.875)
    expect(sprite.w).toBe(0.5);
    expect(sprite.h).toBe(0.5);
    expect(sprite.x).toBe(10);
    expect(sprite.y).toBe(19.625);
  });

  it("orders by sortY so lower entities draw later", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "wooden-chest",
            position: { x: 0.5, y: 0.5 },
          },
          {
            entity_number: 2,
            name: "wooden-chest",
            position: { x: 0.5, y: 2.5 },
          },
        ],
      }),
      db,
    );
    const objects = list.commands.filter(
      (c) => c.kind === "sprite" && c.layer === RENDER_LAYERS.object,
    );
    expect(objects).toHaveLength(2);
    expect(objects[0]?.entity).toBe(1);
    expect(objects[1]?.entity).toBe(2);
    expect(objects[0]?.sortY).toBeLessThan(objects[1]?.sortY ?? Number.POSITIVE_INFINITY);
  });

  it("orders same-Y object sprites west then east via sortX", () => {
    // Higher entity_number on the west tile — without sortX it would paint after east.
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 8,
            name: "underground-belt",
            position: { x: 1.5, y: 0.5 },
            direction: 0,
            type: "output",
          },
          {
            entity_number: 10,
            name: "underground-belt",
            position: { x: 0.5, y: 0.5 },
            direction: 0,
            type: "output",
          },
        ],
      }),
      db,
      { beltEndings: false },
    );
    const objects = list.commands.filter(
      (c) => c.kind === "sprite" && c.layer === RENDER_LAYERS.object,
    );
    expect(objects.length).toBeGreaterThanOrEqual(2);
    expect(objects[0]?.sortX).toBeLessThan(objects[1]?.sortX ?? Number.POSITIVE_INFINITY);
    expect(objects[0]?.entity).toBe(10);
    expect(objects[1]?.entity).toBe(8);
  });

  it("paints entity shadows above belts (Factorio order)", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "wooden-chest",
            position: { x: 0.5, y: 0.5 },
          },
          {
            entity_number: 2,
            name: "transport-belt",
            position: { x: 1.5, y: 0.5 },
            direction: 4,
          },
        ],
      }),
      db,
      { beltEndings: false },
    );
    const shadow = list.commands.find(
      (c) => c.kind === "sprite" && c.entity === 1 && c.shadow === true,
    );
    const belt = list.commands.find((c) => c.kind === "sprite" && c.entity === 2);
    expect(shadow?.layer).toBe(RENDER_LAYERS.shadow);
    expect(belt?.layer).toBe(RENDER_LAYERS["transport-belt"]);
    expect(shadow!.layer).toBeGreaterThan(belt!.layer);
  });

  it("keeps sub-order stable within an entity", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "wooden-chest",
            position: { x: 0.5, y: 0.5 },
          },
        ],
      }),
      db,
    );
    const sprites = list.commands.filter((c) => c.kind === "sprite" && c.entity === 1);
    // graphics[0]=object, graphics[1]=shadow — different layers, but sub matches group index
    const object = sprites.find((c) => c.layer === RENDER_LAYERS.object);
    const shadow = sprites.find((c) => c.layer === RENDER_LAYERS.shadow);
    expect(object?.sub).toBe(0);
    expect(shadow?.sub).toBe(1);
  });

  it("renders unsupported mod entities with the baked marker sprite", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "wooden-chest",
            position: { x: 0.5, y: 0.5 },
          },
          {
            entity_number: 2,
            name: "modded-assembler",
            position: { x: 2.5, y: 0.5 },
          },
        ],
      }),
      db,
    );
    const unsupported = list.commands.find((c) => c.kind === "sprite" && c.entity === 2) as
      | SpriteCmd
      | undefined;
    expect(unsupported).toMatchObject({
      kind: "sprite",
      layer: RENDER_LAYERS.object,
      x: 2,
      y: 0,
      w: 1,
      h: 1,
    });
    expect(list.commands.some((c) => c.kind === "sprite" && c.entity === 1)).toBe(true);
    expect(list.commands.some((c) => c.kind === "rect" && c.entity === 2)).toBe(false);
  });

  it("falls back to orange rect when the marker icon is absent", () => {
    const dbNoMarker: typeof db = {
      ...db,
      icons: { ...db.icons, "utility/unsupported-entity": undefined as unknown as number },
    };
    delete (dbNoMarker.icons as Record<string, number>)["utility/unsupported-entity"];
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "modded-assembler",
            position: { x: 2.5, y: 0.5 },
          },
        ],
      }),
      dbNoMarker,
    );
    expect(list.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "rect",
          entity: 1,
          color: [1, 0.55, 0, 1],
        }),
      ]),
    );
  });

  it("emits tile rects with correct color", () => {
    const list = planDrawList(
      bp({
        tiles: [{ name: "stone-path", position: { x: 3, y: 4 } }],
      }),
      db,
    );
    expect(list.commands).toHaveLength(1);
    const rect = list.commands[0];
    expect(rect).toMatchObject({
      kind: "rect",
      x: 3,
      y: 4,
      w: 1,
      h: 1,
      color: [0.4, 0.35, 0.3, 1],
      layer: RENDER_LAYERS["ground-tile"],
    });
  });

  it("computes tight bounds", () => {
    const list = planDrawList(
      bp({
        tiles: [{ name: "stone-path", position: { x: 1, y: 2 } }],
        entities: [
          {
            entity_number: 1,
            name: "wooden-chest",
            position: { x: 5.5, y: 5.5 },
          },
        ],
      }),
      db,
    );
    // wooden-chest: scale 0.5, sw=32 → 0.5×0.5 centered at 5.5 → [5.25,5.25]-[5.75,5.75]
    // shadow shift [0.1,0.1] → center 5.6 → [5.35,5.35]-[5.85,5.85]
    // tile [1,2]-[2,3]
    expect(list.bounds.minX).toBe(1);
    expect(list.bounds.minY).toBe(2);
    expect(list.bounds.maxX).toBeCloseTo(5.85, 6);
    expect(list.bounds.maxY).toBeCloseTo(5.85, 6);
  });

  it("computes sprite bounds from the visible trimmed atlas rectangle", () => {
    const trimDb = makeMiniDb();
    trimDb.frames[2] = { ...trimDb.frames[2]!, ox: 1 };
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "flip-chest",
            position: { x: 0.5, y: 0.5 },
          },
        ],
      }),
      trimDb,
    );

    // Untrimmed destination is [0.25, 0.25]–[0.75, 0.75]. The 24×20 trim
    // starts at pixel (1, 6), then flipX mirrors it around the 0.5 center.
    expect(list.bounds.minX).toBeCloseTo(0.359375);
    expect(list.bounds.maxX).toBeCloseTo(0.734375);
    expect(list.bounds.minY).toBeCloseTo(0.34375);
    expect(list.bounds.maxY).toBeCloseTo(0.65625);
  });

  it("emits altMode assembler recipe icon", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "assembling-machine-1",
            position: { x: 1.5, y: 1.5 },
            recipe: "iron-gear-wheel",
          },
        ],
      }),
      db,
      { altMode: true },
    );
    const icon = list.commands.find((c) => c.kind === "icon");
    expect(icon).toMatchObject({
      kind: "icon",
      frame: 3,
      x: 1.5,
      y: 1.5,
      size: 0.75,
      backing: true,
      layer: RENDER_LAYERS.icons,
    });
  });

  it("is deterministic across two runs", () => {
    const input = bp({
      tiles: [{ name: "stone-path", position: { x: 0, y: 0 } }],
      entities: [
        {
          entity_number: 1,
          name: "wooden-chest",
          position: { x: 1.5, y: 1.5 },
        },
        {
          entity_number: 2,
          name: "inserter-like",
          position: { x: 2.5, y: 1.5 },
          direction: 4,
        },
      ],
    });
    const a = planDrawList(input, db);
    const b = planDrawList(input, db);
    expect(serializeDrawList(a)).toBe(serializeDrawList(b));
  });

  it("empty blueprint yields zero bounds and no commands", () => {
    const list = planDrawList(bp({}), db);
    expect(list.commands).toEqual([]);
    expect(list.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("serializeDrawList snapshot for a small 3-entity blueprint", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "wooden-chest",
            position: { x: 0.5, y: 0.5 },
          },
          {
            entity_number: 2,
            name: "inserter-like",
            position: { x: 1.5, y: 0.5 },
            direction: 8,
          },
          {
            entity_number: 3,
            name: "transport-belt",
            position: { x: 2.5, y: 0.5 },
            direction: 4,
          },
        ],
      }),
      db,
      { beltEndings: false },
    );
    expect(serializeDrawList(list)).toBe(
      [
        "{",
        '"schema": 1,',
        '"bounds": {"maxX":2.75,"maxY":0.85,"minX":0.25,"minY":0.25},',
        '"commands": [',
        '{"entity":3,"frame":0,"h":0.5,"kind":"sprite","layer":27,"sortX":0,"sortY":0,"sub":0,"w":0.5,"x":2.25,"y":0.25},',
        '{"entity":1,"frame":0,"h":0.5,"kind":"sprite","layer":37,"shadow":true,"sortX":0,"sortY":0,"sub":1,"w":0.5,"x":0.35,"y":0.35},',
        '{"entity":2,"frame":0,"h":0.5,"kind":"sprite","layer":39,"sortX":1.5,"sortY":0.65,"sub":0,"w":0.5,"x":1.25,"y":0.25},',
        '{"entity":1,"frame":0,"h":0.5,"kind":"sprite","layer":39,"sortX":0.5,"sortY":0.9,"sub":0,"w":0.5,"x":0.25,"y":0.25}',
        "]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("splits inserter platform under belts and hands above belts", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "inserter",
            position: { x: 0.5, y: 0.5 },
            direction: 4,
          },
          {
            entity_number: 2,
            name: "transport-belt",
            position: { x: 1.5, y: 0.5 },
            direction: 4,
          },
          {
            entity_number: 3,
            name: "wooden-chest",
            position: { x: 2.5, y: 0.5 },
          },
        ],
      }),
      db,
      { beltEndings: false },
    );
    const sprites = list.commands.filter((c) => c.kind === "sprite" && !c.shadow);
    const platform = sprites.find((c) => c.entity === 1 && c.sub === 0);
    const hands = sprites.filter((c) => c.entity === 1 && c.sub > 0);
    const belt = sprites.find((c) => c.entity === 2);
    const chest = sprites.find((c) => c.entity === 3);
    expect(platform?.layer).toBe(RENDER_LAYERS.floor);
    expect(belt?.layer).toBe(RENDER_LAYERS["transport-belt"]);
    expect(hands.length).toBeGreaterThan(0);
    expect(hands.every((c) => c.layer === RENDER_LAYERS["higher-object-under"])).toBe(true);
    expect(chest?.layer).toBe(RENDER_LAYERS.object);
    expect(platform!.layer).toBeLessThan(belt!.layer);
    expect(belt!.layer).toBeLessThan(Math.min(...hands.map((c) => c.layer)));
    expect(chest!.layer).toBeLessThan(Math.min(...hands.map((c) => c.layer)));
  });

  it("emits quality badge and inserter filter in altMode", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "assembling-machine-1",
            position: { x: 1.5, y: 1.5 },
            recipe: "iron-gear-wheel",
            quality: "rare",
          },
          {
            entity_number: 2,
            name: "inserter",
            position: { x: 4.5, y: 1.5 },
            direction: 4,
            filters: [{ index: 1, name: "iron-plate" }],
          },
        ],
      }),
      db,
      { altMode: true },
    );
    const icons = list.commands.filter((c) => c.kind === "icon");
    expect(icons.some((c) => c.size === 0.75 && c.backing === true)).toBe(true);
    expect(icons.some((c) => c.size === 0.5 && !c.backing)).toBe(true);
    expect(icons.some((c) => c.entity === 2 && c.size === 0.5 && c.backing === true)).toBe(true);
  });

  it("scales entity quality badge with quality_indicator_scale (1×1 → 0.5)", () => {
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "transport-belt",
            position: { x: 0.5, y: 0.5 },
            quality: "rare",
          },
        ],
      }),
      db,
      { altMode: true },
    );
    const badge = list.commands.find((c) => c.kind === "icon" && c.sub === 90);
    // Base 0.5 tiles × default scale 0.5 for 1-tile entities → 0.25
    expect(badge).toMatchObject({ size: 0.5 * 0.5 });
  });

  it("emits request-pin icons even when altMode is off", () => {
    const pinDb = {
      ...db,
      frames: [...db.frames, { a: 0, x: 0, y: 0, w: 48, h: 63, ox: 8, oy: 1, sw: 64, sh: 64 }],
      icons: {
        ...db.icons,
        "utility/item-request-slot": db.frames.length,
        "item/speed-module-3": 3,
      },
    };
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "assembling-machine-1",
            position: { x: 1.5, y: 1.5 },
            recipe: "iron-gear-wheel",
            items: [
              {
                id: { name: "speed-module-3" },
                items: { in_inventory: [{ inventory: 4, stack: 0 }] },
              },
            ],
          },
        ],
      }),
      pinDb,
      { altMode: false },
    );
    const icons = list.commands.filter((c) => c.kind === "icon");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatchObject({
      backingStyle: "request-pin",
      sub: 20,
      size: 36 / 64,
    });
    expect(icons.some((c) => c.sub === 0)).toBe(false);
  });

  it("includes the larger Factorio backing in alt-overlay bounds", () => {
    const backingDb = {
      ...db,
      frames: [...db.frames, { ...db.frames[0]!, w: 53, h: 53, sw: 53, sh: 53 }],
      icons: {
        ...db.icons,
        "utility/entity-info-dark-background": db.frames.length,
      },
    };
    const list = planDrawList(
      bp({
        entities: [
          {
            entity_number: 1,
            name: "inserter",
            position: { x: 0.5, y: 0.5 },
            filters: [{ index: 1, name: "iron-plate" }],
          },
        ],
      }),
      backingDb,
      { altMode: true },
    );
    // Inserter alt icons use scale 0.5; bounds take max(backing, icon+silhouette pad).
    const iconSize = 0.5;
    const silhouettePad = (entityInfoSilhouettePadPx() / 32) * iconSize;
    const half = Math.max(iconSize / 2 + silhouettePad, (53 * (iconSize / 32)) / 2);
    expect(list.bounds.minX).toBeCloseTo(0.5 - half);
    expect(list.bounds.minY).toBeCloseTo(0.5 - half);
    expect(list.bounds.maxX).toBeCloseTo(0.5 + half);
    expect(list.bounds.maxY).toBeCloseTo(0.5 + half);
  });
});
