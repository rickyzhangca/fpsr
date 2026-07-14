import { describe, expect, it } from "vite-plus/test";
import { getPipelinePaths } from "../src/paths.js";
import type { EntityRenderDef, FrameMeta, RenderDb, SpriteVariant } from "../src/types.js";
import { readAssetBundle } from "../src/verify.js";

async function loadDb(): Promise<RenderDb> {
  return (await readAssetBundle(getPipelinePaths().versionOut)).db;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function assertSpriteVariant(v: SpriteVariant | null, framesLen: number, pathHint: string): void {
  if (v == null) return;
  expect(isFiniteNumber(v.frame), `${pathHint}.frame`).toBe(true);
  expect(v.frame).toBeGreaterThanOrEqual(0);
  expect(v.frame).toBeLessThan(framesLen);
  expect(isFiniteNumber(v.scale), `${pathHint}.scale`).toBe(true);
  expect(Array.isArray(v.shift) && v.shift.length === 2).toBe(true);
}

function assertEntity(name: string, e: EntityRenderDef, framesLen: number): void {
  expect(typeof e.kind).toBe("string");
  expect(typeof e.protoType).toBe("string");
  expect(e.collisionBox).toHaveLength(2);
  expect(e.selectionBox).toHaveLength(2);
  expect(Array.isArray(e.graphics)).toBe(true);
  for (const [gi, g] of e.graphics.entries()) {
    expect(["single", "direction4", "direction8", "direction16", "resolver"]).toContain(g.indexing);
    expect(typeof g.layer).toBe("string");
    expect(g.variants && typeof g.variants).toBe("object");
    for (const [vk, arr] of Object.entries(g.variants)) {
      expect(Array.isArray(arr), `${name}.graphics[${gi}].variants.${vk}`).toBe(true);
      for (const [ii, v] of arr.entries()) {
        assertSpriteVariant(v, framesLen, `${name}/${gi}/${vk}/${ii}`);
      }
    }
  }
  if (e.icon != null) {
    expect(e.icon).toBeGreaterThanOrEqual(0);
    expect(e.icon).toBeLessThan(framesLen);
  }
}

function collectFrameIds(db: RenderDb): Set<number> {
  const ids = new Set<number>();
  const add = (v: SpriteVariant | null | undefined) => {
    if (v) ids.add(v.frame);
  };
  const addLayerVariants = (layers: Record<string, unknown> | undefined) => {
    if (!layers) return;
    for (const val of Object.values(layers)) {
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        if (Array.isArray(item)) {
          for (const v of item) add(v as SpriteVariant | null);
        } else {
          add(item as SpriteVariant | null);
        }
      }
    }
  };
  for (const e of Object.values(db.entities)) {
    if (e.icon != null) ids.add(e.icon);
    for (const g of e.graphics) {
      for (const arr of Object.values(g.variants)) {
        for (const v of arr) add(v);
      }
    }
    const data = e.data as
      | {
          wireConnectorGraphics?: { layers?: Record<string, unknown> };
          beltConnectorGraphics?: { layers?: Record<string, unknown> };
        }
      | undefined;
    addLayerVariants(data?.wireConnectorGraphics?.layers);
    addLayerVariants(data?.beltConnectorGraphics?.layers);
    const brg = data?.beltReaderGraphics as
      | { layers?: { variants?: (SpriteVariant | null)[][] }[] }
      | undefined;
    for (const layer of brg?.layers ?? []) {
      for (const row of layer.variants ?? []) {
        for (const v of row) add(v);
      }
    }
  }
  for (const t of Object.values(db.tiles)) {
    for (const f of t.frames ?? []) ids.add(f);
  }
  for (const f of Object.values(db.icons)) ids.add(f);
  return ids;
}

describe("render-db contract", () => {
  it("has required top-level shape", async () => {
    const db = await loadDb();
    expect(db.schema).toBe(2);
    expect(db.gameVersion).toBe(getPipelinePaths().install.version);
    expect(Array.isArray(db.mods)).toBe(true);
    expect(db.mods.length).toBeGreaterThan(0);
    expect(Array.isArray(db.atlases)).toBe(true);
    expect(Array.isArray(db.frames)).toBe(true);
    expect(db.entities && typeof db.entities).toBe("object");
    expect(db.tiles && typeof db.tiles).toBe("object");
    expect(db.icons && typeof db.icons).toBe("object");

    for (const a of db.atlases) {
      expect(typeof a.file).toBe("string");
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
    }
    for (const [i, f] of db.frames.entries()) {
      for (const k of ["a", "x", "y", "w", "h", "ox", "oy", "sw", "sh"] as const) {
        expect(isFiniteNumber(f[k]), `frames[${i}].${k}`).toBe(true);
      }
    }
    for (const [name, e] of Object.entries(db.entities)) {
      assertEntity(name, e, db.frames.length);
    }
    for (const [name, t] of Object.entries(db.tiles)) {
      expect(t.color).toHaveLength(4);
      for (const f of t.frames ?? []) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(db.frames.length);
      }
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("contains complete alt-mode icon namespaces and placement metadata", async () => {
    const db = await loadDb();
    for (const key of [
      "recipe/burner-inserter",
      "item/pipe",
      "fluid/water",
      "virtual-signal/signal-A",
      "quality/legendary",
      "space-location/solar-system-edge",
      "asteroid-chunk/metallic-asteroid-chunk",
      "utility/entity-info-dark-background",
      "utility/missing-icon",
      "utility/filter-blacklist",
      "utility/indication-arrow",
      "utility/item-request-slot",
      "utility/unsupported-entity",
    ]) {
      expect(db.icons[key]).toBeDefined();
    }
    expect(Object.keys(db.icons).length).toBeGreaterThan(1_300);
    expect(db.entities["assembling-machine-2"]?.iconDrawSpecification).toEqual({
      shift: [0, -0.3],
      scale: 1,
      scaleForMany: 1,
      renderLayer: "entity-info-icon",
    });
    expect(db.entities["fast-splitter"]?.iconDrawSpecification?.scale).toBe(0.5);
    expect(
      (
        db.entities["arithmetic-combinator"]?.data?.combinatorGraphics as {
          symbols?: Record<string, unknown[]>;
        }
      )?.symbols?.["*"],
    ).toHaveLength(4);
    expect(db.iconScales?.["utility/indication-arrow"]).toBe(0.5);
    expect(db.iconScales?.["utility/filter-blacklist"]).toBe(0.3);
    expect(db.icons["item/water-barrel"]).not.toBe(db.icons["item/empty-barrel"]);
    expect(db.icons["item/water-barrel"]).not.toBe(db.icons["item/sulfuric-acid-barrel"]);
    expect(db.icons["item/lane-splitter"]).not.toBe(db.icons["item/splitter"]);
  });

  it("every referenced FrameId exists and fits its atlas", async () => {
    const db = await loadDb();
    const used = collectFrameIds(db);
    for (const id of used) {
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(db.frames.length);
      const f = db.frames[id] as FrameMeta;
      const atlas = db.atlases[f.a];
      expect(atlas, `frame ${id} atlas ${f.a}`).toBeTruthy();
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.w).toBeLessThanOrEqual(atlas?.width);
      expect(f.y + f.h).toBeLessThanOrEqual(atlas?.height);
      expect(f.w).toBeGreaterThan(0);
      expect(f.h).toBeGreaterThan(0);
      expect(f.sw).toBeGreaterThanOrEqual(f.w);
      expect(f.sh).toBeGreaterThanOrEqual(f.h);
    }
  });

  it("spot-checks belt, pipe, and wooden-chest", async () => {
    const db = await loadDb();

    const belt = db.entities["transport-belt"];
    expect(belt?.kind).toBe("belt");
    const beltLayer = belt?.graphics.find((g) => g.layer === "transport-belt");
    expect(beltLayer?.indexing).toBe("resolver");
    expect(beltLayer?.variants.default).toHaveLength(20);

    const pipe = db.entities.pipe;
    expect(pipe?.kind).toBe("pipe");
    const pipeLayer = pipe?.graphics[0];
    expect(pipeLayer).toBeTruthy();
    const masks = Object.keys(pipeLayer?.variants ?? {});
    expect(masks).toHaveLength(16);
    expect(masks.sort()).toEqual(
      [
        "0000",
        "0001",
        "0010",
        "0011",
        "0100",
        "0101",
        "0110",
        "0111",
        "1000",
        "1001",
        "1010",
        "1011",
        "1100",
        "1101",
        "1110",
        "1111",
      ].sort(),
    );

    const chest = db.entities["wooden-chest"];
    expect(chest).toBeTruthy();
    const objectLayer = chest?.graphics.find((g) => g.layer === "object");
    expect(objectLayer).toBeTruthy();
    const spr = objectLayer?.variants.default?.[0];
    expect(spr).toBeTruthy();
    if (!spr) throw new Error("missing wooden-chest sprite");
    const frame = db.frames[spr.frame];
    expect(frame).toBeTruthy();
    if (!frame) throw new Error("missing wooden-chest frame");

    for (const name of ["legacy-straight-rail", "legacy-curved-rail"] as const) {
      const rail = db.entities[name];
      expect(rail?.kind, name).toBe("rail");
      expect(rail?.protoType, name).toBe(name);
      expect(rail?.graphics.length, name).toBeGreaterThan(0);
      expect(db.icons[`entity/${name}`], `entity/${name} icon`).toBeTypeOf("number");
    }

    const loco = db.entities.locomotive;
    expect(loco?.kind).toBe("train");
    expect(loco?.graphics.some((g) => g.layer === "object")).toBe(true);
    expect(typeof loco?.data?.colorMaskGroupIndex).toBe("number");
    expect(loco?.data?.defaultColor).toEqual([0.92, 0.07, 0, 1]);
    expect(loco?.graphics.length).toBeGreaterThanOrEqual(3);
    const tileW = (frame.sw * spr.scale) / 32;
    const tileH = (frame.sh * spr.scale) / 32;
    expect(tileW).toBeGreaterThanOrEqual(0.5);
    expect(tileW).toBeLessThanOrEqual(2);
    expect(tileH).toBeGreaterThanOrEqual(0.5);
    expect(tileH).toBeLessThanOrEqual(2);
  });

  it("keeps static beacon layers plus empty module-slot covers", async () => {
    const db = await loadDb();
    const beacon = db.entities.beacon;
    expect(beacon).toBeTruthy();
    expect(beacon?.graphics.map((group) => group.layer)).toEqual([
      "floor-mechanics",
      "shadow",
      "object",
      "lower-object",
      "lower-object",
    ]);
    expect(beacon?.graphics).toHaveLength(5);
  });

  it("distills circuit connector graphics for inserter and assembling-machine-2", async () => {
    const db = await loadDb();
    for (const name of ["inserter", "assembling-machine-2"] as const) {
      const e = db.entities[name];
      expect(e).toBeTruthy();
      const wcg = e?.data?.wireConnectorGraphics as
        | {
            indexing?: string;
            layers?: Record<string, (SpriteVariant | null)[]>;
          }
        | undefined;
      expect(wcg?.indexing).toBe("direction4");
      expect(wcg?.layers?.connector_main).toHaveLength(4);
      for (const [i, v] of (wcg?.layers?.connector_main ?? []).entries()) {
        assertSpriteVariant(v, db.frames.length, `${name}.connector_main[${i}]`);
      }
    }
    const inserter = db.entities.inserter?.data?.wireConnectorGraphics as {
      layers?: Record<string, unknown>;
    };
    expect(inserter?.layers?.wire_pins).toBeTruthy();
    expect(inserter?.layers?.led_blue_off).toBeTruthy();
  });

  it("distills belt connector graphics for transport-belt", async () => {
    const db = await loadDb();
    const e = db.entities["transport-belt"];
    expect(e).toBeTruthy();
    const bcg = e?.data?.beltConnectorGraphics as
      | {
          indexing?: string;
          layers?: {
            frame_main?: (SpriteVariant | null)[][];
            frame_shadow?: (SpriteVariant | null)[][];
            frame_back_patch?: (SpriteVariant | null)[];
            wire_horizontal?: (SpriteVariant | null)[][];
            wire_vertical?: (SpriteVariant | null)[][];
            led_red?: (SpriteVariant | null)[];
          };
        }
      | undefined;
    expect(bcg?.indexing).toBe("belt-topology");
    expect(bcg?.layers?.frame_main).toHaveLength(7);
    for (const [vi, row] of (bcg?.layers?.frame_main ?? []).entries()) {
      expect(row, `frame_main[${vi}]`).toHaveLength(4);
      for (const [fi, v] of row.entries()) {
        assertSpriteVariant(v, db.frames.length, `transport-belt.frame_main[${vi}][${fi}]`);
      }
    }
    expect(bcg?.layers?.frame_shadow).toHaveLength(7);
    expect(bcg?.layers?.frame_back_patch).toHaveLength(3);
    expect(bcg?.layers?.wire_horizontal).toHaveLength(7);
    expect(bcg?.layers?.wire_vertical).toHaveLength(7);
    expect(bcg?.layers?.led_red).toHaveLength(7);
  });

  it("distills belt reader graphics for transport-belt", async () => {
    const db = await loadDb();
    const e = db.entities["transport-belt"];
    const brg = e?.data?.beltReaderGraphics as
      | {
          indexing?: string;
          layers?: { layer: string; variants: (SpriteVariant | null)[][] }[];
        }
      | undefined;
    expect(brg?.indexing).toBe("belt-reader-band-nesw");
    expect(brg?.layers?.length).toBeGreaterThanOrEqual(4);
    for (const [i, layer] of (brg?.layers ?? []).entries()) {
      expect(layer.variants, `beltReader[${i}]`).toHaveLength(4);
      for (const [b, row] of layer.variants.entries()) {
        expect(row, `beltReader[${i}][${b}]`).toHaveLength(4);
      }
      expect(typeof layer.layer).toBe("string");
      expect(
        layer.variants.some((row) => row.some((v) => v != null)),
        `beltReader[${i}] has art`,
      ).toBe(true);
    }
  });
});
