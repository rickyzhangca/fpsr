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

function assertSpriteVariant(v: SpriteVariant | null, framesLen: number): void {
  if (v == null) return;
  expect(isFiniteNumber(v.frame)).toBe(true);
  expect(v.frame).toBeGreaterThanOrEqual(0);
  expect(v.frame).toBeLessThan(framesLen);
  expect(isFiniteNumber(v.scale)).toBe(true);
  expect(Array.isArray(v.shift) && v.shift.length === 2).toBe(true);
}

function assertEntity(e: EntityRenderDef, framesLen: number): void {
  expect(typeof e.kind).toBe("string");
  expect(typeof e.protoType).toBe("string");
  expect(e.collisionBox).toHaveLength(2);
  expect(e.selectionBox).toHaveLength(2);
  expect(Array.isArray(e.graphics)).toBe(true);
  for (const g of e.graphics) {
    expect(["single", "direction4", "direction8", "direction16", "resolver"]).toContain(g.indexing);
    expect(typeof g.layer).toBe("string");
    expect(g.variants && typeof g.variants).toBe("object");
    for (const arr of Object.values(g.variants)) {
      expect(Array.isArray(arr)).toBe(true);
      for (const v of arr) {
        assertSpriteVariant(v, framesLen);
      }
    }
  }
  expect(e.icon == null || (e.icon >= 0 && e.icon < framesLen)).toBe(true);
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
          cargoBayConnections?: {
            tileset?: { layers?: { variant?: SpriteVariant }[] }[][][];
            bridges?: Record<string, { layers?: { variant?: SpriteVariant }[] }[]>;
          };
          cargoBayConnectionsPlatform?: {
            tileset?: { layers?: { variant?: SpriteVariant }[] }[][][];
            bridges?: Record<string, { layers?: { variant?: SpriteVariant }[] }[]>;
          };
        }
      | undefined;
    addLayerVariants(data?.wireConnectorGraphics?.layers);
    addLayerVariants(data?.beltConnectorGraphics?.layers);
    type CargoConn = {
      tileset?: { layers?: { variant?: SpriteVariant }[] }[][][];
      bridges?: Record<string, { layers?: { variant?: SpriteVariant }[] }[]>;
    };
    const addCargoConn = (conn: CargoConn | undefined) => {
      if (!conn) return;
      for (const groups of conn.tileset ?? []) {
        for (const group of groups) {
          for (const cell of group) {
            for (const layer of cell.layers ?? []) add(layer.variant ?? null);
          }
        }
      }
      for (const cells of Object.values(conn.bridges ?? {})) {
        for (const cell of cells) {
          for (const layer of cell.layers ?? []) add(layer.variant ?? null);
        }
      }
    };
    addCargoConn(data?.cargoBayConnections);
    addCargoConn(data?.cargoBayConnectionsPlatform);
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
    if (t.material?.sheet != null) ids.add(t.material.sheet);
  }
  for (const background of Object.values(db.terrainBackgrounds ?? {})) {
    for (const f of background?.frames ?? []) ids.add(f);
    for (const patch of background?.patches ?? []) {
      for (const f of patch.frames) ids.add(f);
    }
  }
  if (db.spaceBackground) {
    ids.add(db.spaceBackground.planetFrame);
    for (const f of Object.values(db.spaceBackground.planets ?? {})) ids.add(f);
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
    expect(db.terrainBackgrounds && typeof db.terrainBackgrounds).toBe("object");
    expect(db.spaceBackground == null || typeof db.spaceBackground.planetFrame === "number").toBe(
      true,
    );
    expect(db.icons && typeof db.icons).toBe("object");

    for (const a of db.atlases) {
      expect(typeof a.file).toBe("string");
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
    }
    for (const f of db.frames) {
      for (const k of ["a", "x", "y", "w", "h", "ox", "oy", "sw", "sh"] as const) {
        expect(isFiniteNumber(f[k])).toBe(true);
      }
    }
    for (const e of Object.values(db.entities)) {
      assertEntity(e, db.frames.length);
    }
    for (const [name, t] of Object.entries(db.tiles)) {
      expect(t.color).toHaveLength(4);
      for (const f of t.frames ?? []) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(db.frames.length);
      }
      expect(
        t.material == null ||
          (t.material.sheet >= 0 &&
            t.material.sheet < db.frames.length &&
            t.material.count > 0 &&
            t.material.patchW > 0 &&
            t.material.patchH > 0 &&
            t.material.tilePx > 0),
      ).toBe(true);
      expect(name.length).toBeGreaterThan(0);
    }
    for (const name of ["dirt", "water", "vulcanus", "gleba", "fulgora", "aquilo"] as const) {
      const background = db.terrainBackgrounds?.[name];
      expect(background).toBeDefined();
      expect(background?.patchSize).toBeGreaterThan(0);
      expect(background?.frames.length).toBeGreaterThan(0);
      expect(background?.color).toHaveLength(4);
      for (const frame of background?.frames ?? []) {
        expect(frame).toBeGreaterThanOrEqual(0);
        expect(frame).toBeLessThan(db.frames.length);
      }
      for (const patch of [background, ...(background?.patches ?? [])]) {
        expect(patch?.patchSize).toBeGreaterThan(0);
        expect(patch?.frames.length).toBeGreaterThan(0);
        for (const frame of patch?.frames ?? []) {
          expect(frame).toBeGreaterThanOrEqual(0);
          expect(frame).toBeLessThan(db.frames.length);
        }
        expect(
          patch?.weights == null ||
            (patch.weights.length === patch.frames.length &&
              patch.weights.every((weight) => Number.isFinite(weight) && weight > 0)),
        ).toBe(true);
      }
    }
    expect(db.terrainBackgrounds?.dirt?.patchSize).toBe(4);
    expect(db.terrainBackgrounds?.dirt?.frames).toHaveLength(16);
    expect(db.terrainBackgrounds?.water?.patchSize).toBe(32);
    expect(db.terrainBackgrounds?.water?.frames).toHaveLength(1);
    expect(db.terrainBackgrounds?.vulcanus?.patchSize).toBe(4);
    expect(db.terrainBackgrounds?.gleba?.patchSize).toBe(4);
    expect(db.terrainBackgrounds?.fulgora?.patchSize).toBe(8);
    expect(db.terrainBackgrounds?.aquilo?.patchSize).toBe(4);
    for (const name of ["dirt", "vulcanus", "gleba", "aquilo"] as const) {
      expect(db.terrainBackgrounds?.[name]?.patches?.map((patch) => patch.patchSize)).toEqual([
        2, 1,
      ]);
    }
    expect(db.terrainBackgrounds?.fulgora?.patches).toBeUndefined();
    const terrainSeeds = Object.values(db.terrainBackgrounds ?? {}).map(
      (background) => background?.seed,
    );
    expect(terrainSeeds.every((seed) => seed == null || Number.isInteger(seed))).toBe(true);
    const definedTerrainSeeds = terrainSeeds.filter((seed) => seed != null);
    expect(new Set(definedTerrainSeeds).size).toBe(definedTerrainSeeds.length);
    const spaceBackground = db.spaceBackground;
    expect(spaceBackground).toBeDefined();
    expect(spaceBackground!.planetFrame).toBeGreaterThanOrEqual(0);
    expect(spaceBackground!.planetFrame).toBeLessThan(db.frames.length);
    for (const frame of Object.values(spaceBackground!.planets ?? {})) {
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(db.frames.length);
    }
    expect(spaceBackground!.planets?.nauvis).toBe(spaceBackground!.planetFrame);
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
      "utility/blueprint-snap-full",
      "utility/blueprint-snap-corner-sm",
      "utility/blueprint-snap-corner-lg",
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
    expect(db.entities["assembling-machine-2"]?.data?.fluidBoxesRequireFluidRecipe).toBe(true);
    expect(db.entities["assembling-machine-2"]?.data?.fluidConnectionRoles?.["0"]).toEqual([
      "input",
      "output",
    ]);
    expect(db.entities["chemical-plant"]?.data?.fluidBoxesRequireFluidRecipe).toBeUndefined();
    expect(db.fluidRecipes?.concrete).toEqual({ ingredients: true, products: false });
    expect(db.fluidRecipes?.["iron-gear-wheel"]).toBeUndefined();
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

  it("distills reactor lower pipes and per-port connection patches", async () => {
    const db = await loadDb();
    const reactor = db.entities["nuclear-reactor"];
    expect(reactor?.data?.heatConnections?.["0"]).toHaveLength(12);
    expect(reactor?.data?.heatConnectionPatchGroupIndices).toHaveLength(1);
    const patchIndex = reactor?.data?.heatConnectionPatchGroupIndices?.[0];
    expect(patchIndex).toBeTypeOf("number");
    const patchGroup = patchIndex == null ? undefined : reactor?.graphics[patchIndex];
    expect(patchGroup?.layer).toBe("lower-object");
    expect(patchGroup?.variants.connected).toHaveLength(12);
    expect(patchGroup?.variants.disconnected).toHaveLength(12);
  });

  it("distills elevated-rail guard fences above rails and rail supports below them", async () => {
    const db = await loadDb();
    for (const name of [
      "elevated-straight-rail",
      "elevated-half-diagonal-rail",
      "elevated-curved-rail-a",
      "elevated-curved-rail-b",
    ]) {
      const layers = db.entities[name]?.graphics.map((group) => group.layer) ?? [];
      expect(layers).toContain("elevated-lower-object");
      expect(layers).toContain("elevated-higher-object");
    }

    const rampLayers = db.entities["rail-ramp"]?.graphics.map((group) => group.layer) ?? [];
    expect(rampLayers).toContain("lower-object-above-shadow");
    expect(rampLayers).toContain("object");

    const support = db.entities["rail-support"];
    expect(support?.graphics.some((group) => group.layer === "object")).toBe(true);
    expect(support?.graphics.some((group) => group.layer === "elevated-object")).toBe(false);
  });

  it("keeps every segmented guard-fence slice on curved and half-diagonal elevated rails", async () => {
    const db = await loadDb();
    for (const name of [
      "elevated-half-diagonal-rail",
      "elevated-curved-rail-a",
      "elevated-curved-rail-b",
    ]) {
      const directionZeroLayers =
        db.entities[name]?.graphics
          .filter((group) => group.variants.default?.[0] != null)
          .map((group) => group.layer) ?? [];
      expect(directionZeroLayers.filter((layer) => layer === "elevated-lower-object")).toHaveLength(
        4,
      );
      expect(
        directionZeroLayers.filter((layer) => layer === "elevated-higher-object"),
      ).toHaveLength(4);
    }
  });

  it("keeps elevated rail-deck and rail-ramp shadows", async () => {
    const db = await loadDb();
    const expectedShadowGroups: Record<string, number> = {
      "elevated-straight-rail": 3,
      "elevated-half-diagonal-rail": 5,
      "elevated-curved-rail-a": 5,
      "elevated-curved-rail-b": 5,
      "rail-ramp": 1,
    };
    for (const [name, expected] of Object.entries(expectedShadowGroups)) {
      const shadows =
        db.entities[name]?.graphics.filter(
          (group) => group.layer === "shadow" && group.variants.default?.[0] != null,
        ) ?? [];
      expect(shadows).toHaveLength(expected);
    }
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
      expect(rail?.kind).toBe("rail");
      expect(rail?.protoType).toBe(name);
      expect(rail?.graphics.length).toBeGreaterThan(0);
      expect(db.icons[`entity/${name}`]).toBeTypeOf("number");
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

  it("covers the roboport bay with closed doors, base patch, and idle antenna", async () => {
    const db = await loadDb();
    const roboport = db.entities.roboport;
    expect(roboport).toBeTruthy();
    // base+shadow (2) + base_patch + door_down + door_up + base_animation.
    expect(roboport!.graphics.length).toBeGreaterThanOrEqual(6);
    const shiftsY = roboport!.graphics
      .map((group) => group.variants.default?.[0]?.shift?.[1])
      .filter((y): y is number => typeof y === "number");
    // Closed door sheets sit above the body center (negative shift Y).
    expect(shiftsY.some((y) => y < -0.5)).toBe(true);
    // Idle antenna is the highest still-frame on the unit.
    expect(Math.min(...shiftsY)).toBeLessThan(-2);
  });

  it("includes always_draw mining-drill working visualisations (heads / fronts)", async () => {
    const db = await loadDb();
    const electric = db.entities["electric-mining-drill"];
    expect(electric).toBeTruthy();
    // Base still-frame alone is 4 groups; drill head + east/west fronts add more.
    expect(electric?.graphics.length).toBeGreaterThan(4);
    expect(electric?.graphics.some((group) => group.indexing === "direction4")).toBe(true);

    const big = db.entities["big-mining-drill"];
    expect(big).toBeTruthy();
    // Base still + shadow is 2 groups; drill head is a shared always_draw animation.
    expect(big?.graphics.length).toBeGreaterThan(2);
    expect(big?.graphics.some((group) => group.indexing === "single")).toBe(true);

    const pumpjack = db.entities.pumpjack;
    expect(pumpjack).toBeTruthy();
    // Horsehead lives in always_draw working_visualisations on top of the base.
    expect(pumpjack?.graphics.length).toBeGreaterThan(2);
  });

  it("fills electromagnetic-plant idle core and foundry pipes from working visualisations", async () => {
    const db = await loadDb();
    const plant = db.entities["electromagnetic-plant"];
    expect(plant).toBeTruthy();
    // Base + shadow alone is 2 groups; idle always_draw core fills the center hole.
    expect(plant?.graphics.length).toBeGreaterThan(2);

    const foundry = db.entities.foundry;
    expect(foundry).toBeTruthy();
    // Base animation plus always_draw input/output pipe direction layers.
    expect(foundry?.graphics.length).toBeGreaterThan(3);
    expect(foundry?.graphics.some((group) => group.indexing === "direction4")).toBe(true);
  });

  it("fills fusion-reactor neighbour-port cutouts with idle connection patches", async () => {
    const db = await loadDb();
    const reactor = db.entities["fusion-reactor"];
    expect(reactor).toBeTruthy();
    // structure body+shadow (2) plus 8 port patches (most with shadows).
    expect(reactor!.graphics.length).toBeGreaterThan(10);
    const bottomPort = reactor!.graphics.find((group) => {
      const shift = group.variants.default?.[0]?.shift;
      return group.layer === "object" && shift != null && shift[1] > 2;
    });
    expect(bottomPort).toBeTruthy();
    expect(bottomPort!.variants.default![0]!.shift[1]).toBeCloseTo(2.5938, 3);
  });

  it("draws thruster platform mount, pipe stubs, and crusher/collector lower stacks", async () => {
    const db = await loadDb();

    const thruster = db.entities.thruster;
    expect(thruster).toBeTruthy();
    // floor integration + body + 4 always_draw pipe stubs.
    expect(thruster!.graphics.length).toBeGreaterThanOrEqual(6);
    expect(thruster!.graphics.some((group) => group.layer === "floor")).toBe(true);
    const pipeStub = thruster!.graphics.find((group) => {
      const shift = group.variants.default?.[0]?.shift;
      return group.layer === "object" && shift != null && shift[1] > 2.5;
    });
    expect(pipeStub).toBeTruthy();

    const crusher = db.entities.crusher;
    expect(crusher).toBeTruthy();
    expect(crusher!.graphics.some((group) => group.layer === "floor")).toBe(true);
    expect(crusher!.graphics.some((group) => group.indexing === "direction4")).toBe(true);

    const collector = db.entities["asteroid-collector"];
    expect(collector).toBeTruthy();
    expect(collector!.graphics.some((group) => group.layer === "lower-object")).toBe(true);
    // below_arm is object-layer so it shows through the transparent hopper opening.
    expect(
      collector!.graphics.some(
        (group) => group.layer === "object" && (group.variants.default?.[2]?.shift[1] ?? 0) > 1,
      ),
    ).toBe(true);
    expect(collector!.graphics.some((group) => group.indexing === "direction4")).toBe(true);
    // Idle arm head (+ top) fill the hopper.
    expect(collector!.graphics.length).toBeGreaterThan(5);
  });

  it("skips additive cargo-hub emission sheets that would paint as black holes", async () => {
    const db = await loadDb();
    const hub = db.entities["space-platform-hub"];
    expect(hub).toBeTruthy();
    // Emissions were ~392×214 / 194×164 / 202×128 full-bleed black sheets.
    const suspicious = hub!.graphics.filter((group) => {
      const v = group.variants.default?.[0];
      if (!v || v.drawAsShadow) return false;
      const frame = db.frames[v.frame];
      if (!frame) return false;
      const fill = (frame.w * frame.h) / (frame.sw * frame.sh);
      return fill > 0.95 && frame.sw >= 190 && frame.sh >= 120 && (v.shift[1] ?? 0) < -2.5;
    });
    expect(suspicious).toHaveLength(0);
    // Closed giga hatch covers (upper + lower, back + front).
    expect(hub!.graphics.length).toBeGreaterThan(12);
  });

  it("assigns official lower render layers to cargo-bay and space-platform-hub bodies", async () => {
    const db = await loadDb();
    const hub = db.entities["space-platform-hub"];
    expect(hub).toBeTruthy();
    const hubLayers = new Set(hub!.graphics.map((g) => g.layer));
    expect(hubLayers.has("lower-object-above-shadow")).toBe(true);
    expect(hubLayers.has("lower-object-overlay")).toBe(true);
    expect(hubLayers.has("object-under")).toBe(true);
    expect(hubLayers.has("object")).toBe(true);

    const bay = db.entities["cargo-bay"];
    expect(bay).toBeTruthy();
    expect(bay!.graphics.some((g) => g.layer === "lower-object-above-shadow")).toBe(true);
    expect(bay!.graphics.some((g) => g.layer === "object")).toBe(true);
    // Grounded + platform body variants.
    expect(bay!.graphics.some((g) => g.variants.platform != null)).toBe(true);
    expect(bay!.data?.cargoBayConnections).toBeTruthy();
    expect(bay!.data?.cargoBayConnectionsPlatform).toBeTruthy();
    expect(bay!.data!.cargoBayConnectionsPlatform!.tileset.length).toBeGreaterThan(0);
    expect(hub!.data?.cargoBayConnections ?? hub!.data?.cargoBayConnectionsPlatform).toBeTruthy();
  });

  it("distills solar-panel shadow overlay on top of the body", async () => {
    const db = await loadDb();
    const panel = db.entities["solar-panel"];
    expect(panel).toBeTruthy();
    const body = panel!.graphics.find(
      (g) => g.layer === "object" && g.variants.default?.[0] && !g.variants.default[0].drawAsShadow,
    );
    const shadow = panel!.graphics.find((g) => g.layer === "shadow");
    const overlay = panel!.graphics.find((g, i) => {
      const v = g.variants.default?.[0];
      return (
        g.layer === "object" &&
        v != null &&
        !v.drawAsShadow &&
        // Overlay is appended after picture layers.
        i > panel!.graphics.indexOf(body!)
      );
    });
    expect(body).toBeTruthy();
    expect(shadow?.variants.default?.[0]?.drawAsShadow).toBe(true);
    expect(overlay).toBeTruthy();
    // Official util.by_pixel shifts: body (-3, 3.5), shadow (9.5, 6), overlay (10.5, 6).
    expect(body!.variants.default![0]!.shift[0]).toBeCloseTo(-0.0937, 3);
    expect(shadow!.variants.default![0]!.shift[0]).toBeCloseTo(0.2969, 3);
    expect(overlay!.variants.default![0]!.shift[0]).toBeCloseTo(0.3281, 3);
    expect(overlay!.variants.default![0]!.shift[1]).toBeCloseTo(0.1875, 3);
    // Overlay must paint after the body (same object layer, higher group index).
    expect(panel!.graphics.indexOf(overlay!)).toBeGreaterThan(panel!.graphics.indexOf(body!));
  });

  it("places agricultural-tower crane hub above the base silo", async () => {
    const db = await loadDb();
    const tower = db.entities["agricultural-tower"];
    expect(tower).toBeTruthy();
    // Base animation is 3 groups; hub + hub shadow are appended from crane.parts.
    expect(tower?.graphics.length).toBeGreaterThan(3);
    const hub = tower!.graphics.find((group) => {
      const shift = group.variants.default?.[0]?.shift;
      return (
        group.layer === "higher-object-under" && shift != null && Math.abs(shift[0] - 0.5) < 0.01
      );
    });
    expect(hub).toBeTruthy();
    // Crane origin [0.5, -0.55, 4.6] with z*0.5 → screen y ≈ -2.85 plus sprite shift.
    expect(hub!.variants.default![0]!.shift[1]).toBeCloseTo(-2.9906, 3);

    // Shadow is cast onto the ground via shadow_direction, not lifted with the hub.
    const craneShadow = tower!.graphics.find((group) => {
      const v = group.variants.default?.[0];
      return group.layer === "shadow" && v?.drawAsShadow === true && (v.shift[0] ?? 0) > 2;
    });
    expect(craneShadow).toBeTruthy();
    expect(craneShadow!.variants.default![0]!.shift[0]).toBeCloseTo(3.9839, 3);
    expect(craneShadow!.variants.default![0]!.shift[1]).toBeCloseTo(-0.6022, 3);
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
