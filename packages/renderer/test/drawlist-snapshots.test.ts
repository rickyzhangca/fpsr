import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { decode } from "../src/decode.js";
import { planDrawList } from "../src/plan.js";
import {
  BELT_CURVE_RIGHT,
  BELT_END_INDEX,
  BELT_START_INDEX,
  BELT_STRAIGHT_INDEX,
  resolve,
} from "../src/resolve.js";
import type { Blueprint, BlueprintEntity } from "../src/types/blueprint.js";
import { RENDER_LAYERS, serializeDrawList } from "../src/types/draw-list.js";
import type { RenderDb } from "../src/types/render-db.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_DB = path.join(ROOT, "fixtures/render-db/2.1.9.json");
const SNAP_DIR = path.join(ROOT, "fixtures/drawlist");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

const db = JSON.parse(readFileSync(FIXTURE_DB, "utf8")) as RenderDb;

function bp(entities: BlueprintEntity[]): Blueprint {
  return { item: "blueprint", version: 2 * 2 ** 48, entities };
}

function assertSnapshot(name: string, list: ReturnType<typeof planDrawList>): void {
  mkdirSync(SNAP_DIR, { recursive: true });
  const file = path.join(SNAP_DIR, `${name}.snap.txt`);
  const actual = serializeDrawList(list);
  if (UPDATE || !existsSync(file)) {
    writeFileSync(file, actual);
  }
  const expected = readFileSync(file, "utf8");
  if (actual !== expected) {
    const aLines = actual.split("\n");
    const eLines = expected.split("\n");
    let hint = `Snapshot mismatch for ${name}. Re-run with UPDATE_SNAPSHOTS=1 after review.`;
    for (let i = 0; i < Math.max(aLines.length, eLines.length); i++) {
      if (aLines[i] !== eLines[i]) {
        hint += `\n  first diff at line ${i + 1}:\n    expected: ${eLines[i] ?? "<missing>"}\n    actual:   ${aLines[i] ?? "<missing>"}`;
        break;
      }
    }
    expect.fail(hint);
  }
  expect(actual).toBe(expected);
}

/** 4×4 closed clockwise belt loop (12 belts). */
function beltRingEntities(): BlueprintEntity[] {
  const ents: BlueprintEntity[] = [];
  let n = 1;
  for (let x = 0.5; x <= 2.5; x++) {
    ents.push({
      entity_number: n++,
      name: "transport-belt",
      position: { x, y: 0.5 },
      direction: 4,
    });
  }
  ents.push({
    entity_number: n++,
    name: "transport-belt",
    position: { x: 3.5, y: 0.5 },
    direction: 8,
  });
  for (let y = 1.5; y <= 2.5; y++) {
    ents.push({
      entity_number: n++,
      name: "transport-belt",
      position: { x: 3.5, y },
      direction: 8,
    });
  }
  ents.push({
    entity_number: n++,
    name: "transport-belt",
    position: { x: 3.5, y: 3.5 },
    direction: 12,
  });
  for (let x = 2.5; x >= 1.5; x--) {
    ents.push({
      entity_number: n++,
      name: "transport-belt",
      position: { x, y: 3.5 },
      direction: 12,
    });
  }
  ents.push({
    entity_number: n++,
    name: "transport-belt",
    position: { x: 0.5, y: 3.5 },
    direction: 0,
  });
  for (let y = 2.5; y >= 1.5; y--) {
    ents.push({
      entity_number: n++,
      name: "transport-belt",
      position: { x: 0.5, y },
      direction: 0,
    });
  }
  return ents;
}

describe("drawlist snapshots (committed render-db)", () => {
  it("belt-ring: 4x4 loop exposes all four curve variants", () => {
    const entities = beltRingEntities();
    const resolved = resolve(bp(entities), db);
    const mainIdx = new Set(
      resolved.map((r) => r.selections.find((s) => !s.shift)?.index).filter((i) => i != null),
    );
    expect(mainIdx.has(BELT_CURVE_RIGHT[0])).toBe(true);
    expect(mainIdx.has(BELT_CURVE_RIGHT[4])).toBe(true);
    expect(mainIdx.has(BELT_CURVE_RIGHT[8])).toBe(true);
    expect(mainIdx.has(BELT_CURVE_RIGHT[12])).toBe(true);
    // Closed loop → no starting/ending caps.
    for (const r of resolved) {
      expect(r.selections.some((s) => s.shift != null)).toBe(false);
    }
    assertSnapshot("belt-ring", planDrawList(bp(entities), db));
  });

  it("belt-sideload: mid-line stays straight under perpendicular feed", () => {
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "transport-belt", position: { x: 0.5, y: 0.5 }, direction: 4 },
      { entity_number: 2, name: "transport-belt", position: { x: 1.5, y: 0.5 }, direction: 4 },
      { entity_number: 3, name: "transport-belt", position: { x: 2.5, y: 0.5 }, direction: 4 },
      { entity_number: 4, name: "transport-belt", position: { x: 1.5, y: 1.5 }, direction: 0 },
    ];
    const resolved = resolve(bp(entities), db, undefined, { beltEndings: false });
    const mid = resolved.find((r) => r.entity.entity_number === 2);
    expect(mid?.selections[0]?.index).toBe(BELT_STRAIGHT_INDEX[4]);
    assertSnapshot("belt-sideload", planDrawList(bp(entities), db));
  });

  it("underground-gap: in/out variants + endings only at true ends", () => {
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "transport-belt", position: { x: 0.5, y: 0.5 }, direction: 4 },
      {
        entity_number: 2,
        name: "underground-belt",
        position: { x: 1.5, y: 0.5 },
        direction: 4,
        type: "input",
      },
      {
        entity_number: 3,
        name: "underground-belt",
        position: { x: 5.5, y: 0.5 },
        direction: 4,
        type: "output",
      },
      { entity_number: 4, name: "transport-belt", position: { x: 6.5, y: 0.5 }, direction: 4 },
    ];
    const resolved = resolve(bp(entities), db);
    const byNum = new Map(resolved.map((r) => [r.entity.entity_number, r]));
    expect(byNum.get(2)?.selections.some((s) => s.variantKey === "in")).toBe(true);
    expect(byNum.get(3)?.selections.some((s) => s.variantKey === "out")).toBe(true);

    const beltStart = byNum.get(1);
    const beltEnd = byNum.get(4);
    expect(beltStart).toBeTruthy();
    expect(beltEnd).toBeTruthy();
    expect(beltStart?.selections.some((s) => s.index === BELT_START_INDEX[4])).toBe(true);
    expect(beltStart?.selections.some((s) => s.index === BELT_END_INDEX[4])).toBe(false);
    expect(beltEnd?.selections.some((s) => s.index === BELT_END_INDEX[4])).toBe(true);
    expect(beltEnd?.selections.some((s) => s.index === BELT_START_INDEX[4])).toBe(false);

    const objectGroup = db.entities["underground-belt"]?.graphics.find((g) => g.layer === "object");
    const northInFrame = objectGroup?.variants.in?.[0]?.frame;
    const eastInFrame = objectGroup?.variants.in?.[1]?.frame;
    const eastOutFrame = objectGroup?.variants.out?.[3]?.frame;
    expect(eastInFrame).toBeDefined();
    expect(eastOutFrame).toBeDefined();
    expect(eastInFrame).not.toBe(712);
    expect(eastOutFrame).not.toBe(712);
    expect(eastOutFrame).not.toBe(northInFrame);

    const list = planDrawList(bp(entities), db);
    const eastInCmd = list.commands.find(
      (c) => c.kind === "sprite" && c.entity === 2 && c.layer === RENDER_LAYERS.object,
    );
    const eastOutCmd = list.commands.find(
      (c) => c.kind === "sprite" && c.entity === 3 && c.layer === RENDER_LAYERS.object,
    );
    expect(eastInCmd?.kind === "sprite" && eastInCmd.frame).toBe(eastInFrame);
    expect(eastOutCmd?.kind === "sprite" && eastOutCmd.frame).toBe(eastOutFrame);

    assertSnapshot("underground-gap", list);
  });

  it("underground-corpus: all tiers and cardinals", () => {
    const corpusPath = path.join(ROOT, "fixtures/corpus/underground-belt.bp.txt");
    const blueprint = decode(readFileSync(corpusPath, "utf8")).blueprint;
    if (!blueprint) throw new Error("missing blueprint in corpus fixture");
    assertSnapshot("underground-corpus", planDrawList(blueprint, db));
  });

  it("splitter-directions: direct sprites + E/W top patches", () => {
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "fast-splitter", position: { x: 0.5, y: 0.5 }, direction: 0 },
      { entity_number: 2, name: "fast-splitter", position: { x: 4.5, y: 0.5 }, direction: 4 },
      { entity_number: 3, name: "fast-splitter", position: { x: 8.5, y: 0.5 }, direction: 8 },
      { entity_number: 4, name: "fast-splitter", position: { x: 12.5, y: 0.5 }, direction: 12 },
    ];
    const graphics = db.entities["fast-splitter"]?.graphics ?? [];
    const structure = graphics.find(
      (g) =>
        g.layer === "object" && g.variants.default?.[0] != null && g.variants.default?.[1] != null,
    );
    const patch = graphics.find(
      (g) =>
        g.layer === "object-under" &&
        g.variants.default?.[0] == null &&
        g.variants.default?.[1] != null,
    );

    const list = planDrawList(bp(entities), db);
    const objectCmds = (entity: number) =>
      list.commands.filter(
        (c) => c.kind === "sprite" && c.entity === entity && c.layer === RENDER_LAYERS.object,
      );
    const patchCmds = (entity: number) =>
      list.commands.filter(
        (c) =>
          c.kind === "sprite" && c.entity === entity && c.layer === RENDER_LAYERS["object-under"],
      );

    expect(structure?.variants.default?.[0]?.frame).toBeDefined();
    const spriteFrame = (cmds: ReturnType<typeof objectCmds>) => {
      const cmd = cmds[0];
      return cmd?.kind === "sprite" ? cmd.frame : undefined;
    };
    expect(spriteFrame(objectCmds(1))).toBe(structure?.variants.default?.[0]?.frame);
    expect(spriteFrame(objectCmds(2))).toBe(structure?.variants.default?.[1]?.frame);
    expect(spriteFrame(patchCmds(2))).toBe(patch?.variants.default?.[1]?.frame);
    expect(spriteFrame(objectCmds(3))).toBe(structure?.variants.default?.[2]?.frame);
    expect(spriteFrame(objectCmds(4))).toBe(structure?.variants.default?.[3]?.frame);
    expect(spriteFrame(patchCmds(4))).toBe(patch?.variants.default?.[3]?.frame);

    assertSnapshot("splitter-directions", list);
  });

  it("pipe-plant: boiler + pipe cross + tank + pump respect fluidConnections", () => {
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "boiler", position: { x: 0.5, y: 0 }, direction: 0 },
      { entity_number: 2, name: "pipe", position: { x: -1.5, y: 0.5 } },
      { entity_number: 3, name: "pipe", position: { x: 0.5, y: -1.5 } },
      { entity_number: 4, name: "pipe", position: { x: 0.5, y: -2.5 } },
      { entity_number: 5, name: "pipe", position: { x: 0.5, y: -3.5 } },
      { entity_number: 6, name: "pipe", position: { x: -0.5, y: -2.5 } },
      { entity_number: 7, name: "pipe", position: { x: 1.5, y: -2.5 } },
      { entity_number: 8, name: "pipe", position: { x: 0.5, y: -4.5 } },
      { entity_number: 9, name: "pump", position: { x: 0.5, y: -6 }, direction: 0 },
      { entity_number: 10, name: "pipe", position: { x: 0.5, y: -7.5 } },
      // SE south port at [1,2] → pipe tile (0.5,-7.5) when tank is at (-0.5,-9.5).
      { entity_number: 11, name: "storage-tank", position: { x: -0.5, y: -9.5 }, direction: 0 },
    ];
    const resolved = resolve(bp(entities), db);
    const byNum = new Map(resolved.map((r) => [r.entity.entity_number, r]));
    expect(byNum.get(4)?.selections[0]?.variantKey).toBe("1111");
    expect(byNum.get(2)?.selections[0]?.variantKey).toBe("0100"); // east → boiler
    const list = planDrawList(bp(entities), db);
    const coverFrames =
      (
        db.entities["storage-tank"]?.data?.pipeCovers as
          | { covers?: { frame: number }[] }
          | undefined
      )?.covers?.map((c) => c.frame) ?? [];
    expect(coverFrames).toHaveLength(4); // N E S W
    const [nFrame, eFrame, sFrame, wFrame] = coverFrames;

    const coverCmds = list.commands.filter((c) => c.kind === "sprite" && c.sub === 81) as Extract<
      (typeof list.commands)[number],
      { kind: "sprite" }
    >[];
    const byEntity = (n: number) => coverCmds.filter((c) => c.entity === n);

    // Tank S connected → no S cover; unconnected N/E/W get caps.
    const tankFrames = new Set(byEntity(11).map((c) => c.frame));
    expect(tankFrames.has(nFrame!)).toBe(true);
    expect(tankFrames.has(eFrame!)).toBe(true);
    expect(tankFrames.has(wFrame!)).toBe(true);
    expect(tankFrames.has(sFrame!)).toBe(false);

    // Boiler W+N connected → only E cover.
    const boilerFrames = new Set(byEntity(1).map((c) => c.frame));
    expect(boilerFrames.has(eFrame!)).toBe(true);
    expect(boilerFrames.has(wFrame!)).toBe(false);
    expect(boilerFrames.has(nFrame!)).toBe(false);

    // Pump both ports connected → no covers.
    expect(byEntity(9)).toHaveLength(0);

    assertSnapshot("pipe-plant", list);
  });

  it("pipe covers: lone tank emits N/E/S/W caps on all unconnected ports", () => {
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "storage-tank", position: { x: 0.5, y: 0.5 }, direction: 0 },
    ];
    const list = planDrawList(bp(entities), db);
    const coverFrames =
      (
        db.entities["storage-tank"]?.data?.pipeCovers as
          | { covers?: { frame: number }[] }
          | undefined
      )?.covers?.map((c) => c.frame) ?? [];
    expect(coverFrames).toHaveLength(4);
    const got = new Set(
      list.commands
        .filter((c) => c.kind === "sprite" && c.entity === 1 && c.sub === 81)
        .map((c) => (c.kind === "sprite" ? c.frame : -1)),
    );
    for (const f of coverFrames) expect(got.has(f)).toBe(true);
  });

  it("wall-fort: 5x5 wall square with a gate", () => {
    const ents: BlueprintEntity[] = [];
    let n = 1;
    const addWall = (x: number, y: number) => {
      ents.push({ entity_number: n++, name: "stone-wall", position: { x, y } });
    };
    for (let i = 0; i < 5; i++) {
      const t = 0.5 + i;
      addWall(t, 0.5);
      addWall(t, 4.5);
      if (i > 0 && i < 4) {
        addWall(0.5, t);
        addWall(4.5, t);
      }
    }
    const gatePos = { x: 2.5, y: 4.5 };
    const wallIdx = ents.findIndex((e) => e.position.x === gatePos.x && e.position.y === gatePos.y);
    const replaced = wallIdx >= 0 ? ents[wallIdx] : undefined;
    expect(replaced).toBeTruthy();
    if (replaced && wallIdx >= 0) {
      ents[wallIdx] = {
        entity_number: replaced.entity_number,
        name: "gate",
        position: gatePos,
        direction: 0,
      };
    }
    const resolved = resolve(bp(ents), db);
    expect(resolved.find((r) => r.entity.name === "gate")?.selections[0]?.variantKey).toBe(
      "horizontal",
    );
    const left = resolved.find(
      (r) =>
        r.entity.name === "stone-wall" &&
        r.entity.position.x === 1.5 &&
        r.entity.position.y === 4.5,
    );
    // Connected east toward the gate.
    expect(left?.selections[0]?.variantKey?.[1]).toBe("1");
    assertSnapshot("wall-fort", planDrawList(bp(ents), db));
  });

  it("alt-icons: recipe + quality + inserter filter", () => {
    const entities: BlueprintEntity[] = [
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
    ];
    const list = planDrawList(bp(entities), db, { altMode: true });
    const icons = list.commands.filter((c) => c.kind === "icon");
    expect(icons).toHaveLength(3);
    expect(icons.some((c) => c.size === 1 && c.backingFrame != null)).toBe(true);
    expect(icons.some((c) => c.size === 0.5 && !c.backing)).toBe(true);
    expect(icons.some((c) => c.entity === 2 && c.size === 0.5 && c.backingFrame != null)).toBe(
      true,
    );
    assertSnapshot("alt-icons", list);
  });

  it("combinator alt mode uses flow/display art and bare logistic-chest pegs", () => {
    const source = readFileSync(path.join(ROOT, "fixtures/issue-alt-mode.bp.txt"), "utf8");
    const blueprint = decode(source).blueprint;
    if (!blueprint) throw new Error("issue alt-mode fixture is not a blueprint");
    const list = planDrawList(blueprint, db, { altMode: true });

    const icons = list.commands.filter((command) => command.kind === "icon");
    expect(icons).toHaveLength(20); // 9 directional combinators × 2 arrows + 2 empty filters
    expect(icons.every((command) => command.sub >= 110)).toBe(true);
    expect(icons.filter((command) => command.sub === 112).map((command) => command.entity)).toEqual(
      [4, 6],
    );
    expect(
      icons
        .filter((command) => command.sub < 112)
        .every((command) => command.frame === db.icons["utility/indication-arrow"]),
    ).toBe(true);

    const displays = list.commands.filter(
      (command) => command.kind === "sprite" && command.sub === 90,
    );
    expect(displays.map((command) => command.entity)).toEqual([2, 3, 10, 11, 14, 15, 17, 20]);

    const chestConnector = list.commands.filter(
      (command): command is Extract<(typeof list.commands)[number], { kind: "sprite" }> =>
        command.kind === "sprite" && command.entity === 7 && command.sub >= 100,
    );
    expect(chestConnector).toHaveLength(2);
    expect(chestConnector.some((command) => command.shadow)).toBe(true);
    expect(chestConnector.some((command) => !command.shadow)).toBe(true);
  });

  it("module slots: beacon and assembler inventory placements stay separate", () => {
    const source = readFileSync(path.join(ROOT, "fixtures/golden/module-slots.bp.txt"), "utf8");
    const blueprint = decode(source).blueprint;
    if (!blueprint) throw new Error("module-slots fixture is not a blueprint");

    const off = planDrawList(blueprint, db, { altMode: false });
    const offIcons = off.commands.filter((command) => command.kind === "icon");
    expect(offIcons.length).toBeGreaterThan(0);
    expect(
      offIcons.every(
        (command) => command.kind === "icon" && command.backingStyle === "request-pin",
      ),
    ).toBe(true);
    expect(
      off.commands.some(
        (command) => command.kind === "icon" && command.entity === 7 && command.sub === 0,
      ),
    ).toBe(false);
    const offAssemblerPins = off.commands.filter(
      (command): command is Extract<(typeof off.commands)[number], { kind: "icon" }> =>
        command.kind === "icon" && command.entity === 7 && command.sub >= 20 && command.sub < 50,
    );

    const on = planDrawList(blueprint, db, { altMode: true });
    const beaconSlots = on.commands.filter(
      (command) =>
        command.kind === "icon" && command.entity === 1 && command.sub >= 20 && command.sub < 50,
    );
    expect(beaconSlots).toHaveLength(2);
    expect(
      beaconSlots.every(
        (command) => command.kind === "icon" && command.backingStyle === "request-pin",
      ),
    ).toBe(true);
    expect(
      beaconSlots.every(
        (command) =>
          command.kind === "icon" && command.backingFrame === db.icons["utility/item-request-slot"],
      ),
    ).toBe(true);

    const assemblerIcons = on.commands.filter(
      (command): command is Extract<(typeof on.commands)[number], { kind: "icon" }> =>
        command.kind === "icon" && command.entity === 7 && command.sub < 50,
    );
    const recipe = assemblerIcons.find((command) => command.sub === 0);
    const modules = assemblerIcons.filter((command) => command.sub >= 20);
    expect(recipe?.size).toBe(1);
    expect(recipe?.backingStyle).toBeUndefined();
    expect(modules).toHaveLength(4);
    expect(modules.every((command) => command.y > (recipe?.y ?? Number.POSITIVE_INFINITY))).toBe(
      true,
    );
    expect(modules.every((command) => command.backingStyle === "request-pin")).toBe(true);
    expect(
      modules.every((command) => command.backingFrame === db.icons["utility/item-request-slot"]),
    ).toBe(true);
    // Pin positions must not depend on alt mode.
    expect(offAssemblerPins.map((c) => [c.x, c.y, c.frame])).toEqual(
      modules.map((c) => [c.x, c.y, c.frame]),
    );

    assertSnapshot("module-slots-off", off);
    assertSnapshot("module-slots-alt", on);
  });

  it("smoke alt mode adds recipe, splitter filter on lane, and priority arrows", () => {
    const source = readFileSync(path.join(ROOT, "fixtures/golden/smoke.bp.txt"), "utf8");
    const blueprint = decode(source).blueprint;
    if (!blueprint) throw new Error("smoke fixture is not a blueprint");
    const off = planDrawList(blueprint, db, { altMode: false });
    const on = planDrawList(blueprint, db, { altMode: true });
    expect(off.commands.filter((c) => c.kind === "icon")).toHaveLength(0);
    const icons = on.commands.filter((c) => c.kind === "icon");
    // assembling-machine-2 #18: recipe + legendary quality badge
    expect(icons.filter((c) => c.entity === 18)).toHaveLength(2);
    const filtered = icons.filter((c) => c.entity === 45);
    expect(filtered).toHaveLength(2);
    expect(filtered.filter((c) => c.rotation != null)).toHaveLength(1);
    const arrow = filtered.find((c) => c.rotation != null)!;
    const filter = filtered.find((c) => c.rotation == null)!;
    expect(arrow.rotation).toBe(90);
    expect(arrow.size).toBe(db.iconScales?.["utility/indication-arrow"]);
    // Arrows inset on the body (±0.25), not at half-tile belt edges.
    expect(arrow.x).toBeCloseTo(12.25);
    expect(arrow.y).toBeCloseTo(4.5);
    expect(filter).toMatchObject({ x: 12.5, y: 5.5, frame: db.icons["item/pipe"] });
    const dual = icons.filter((c) => c.entity === 50 && c.rotation != null);
    expect(dual).toHaveLength(2);
    expect(dual.every((c) => c.rotation === 0)).toBe(true);
    expect(db.icons["recipe/burner-inserter"]).toBeDefined();
    expect(db.icons["item/pipe"]).toBeDefined();
  });

  it("rail-loop-small: straight + curved-a/b + signal", () => {
    // Synthetic oval: 8 straights + 8 curves + 1 signal. Positions are
    // approximate (not a game-exported string) but exercise rail layers/dirs.
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "straight-rail", position: { x: -1, y: -5 }, direction: 4 },
      { entity_number: 2, name: "straight-rail", position: { x: 1, y: -5 }, direction: 4 },
      { entity_number: 3, name: "straight-rail", position: { x: -1, y: 5 }, direction: 4 },
      { entity_number: 4, name: "straight-rail", position: { x: 1, y: 5 }, direction: 4 },
      { entity_number: 5, name: "straight-rail", position: { x: -5, y: -1 }, direction: 0 },
      { entity_number: 6, name: "straight-rail", position: { x: -5, y: 1 }, direction: 0 },
      { entity_number: 7, name: "straight-rail", position: { x: 5, y: -1 }, direction: 0 },
      { entity_number: 8, name: "straight-rail", position: { x: 5, y: 1 }, direction: 0 },
      { entity_number: 9, name: "curved-rail-a", position: { x: 3, y: -5 }, direction: 4 },
      { entity_number: 10, name: "curved-rail-b", position: { x: 5, y: -3 }, direction: 4 },
      { entity_number: 11, name: "curved-rail-a", position: { x: 5, y: 3 }, direction: 8 },
      { entity_number: 12, name: "curved-rail-b", position: { x: 3, y: 5 }, direction: 8 },
      { entity_number: 13, name: "curved-rail-a", position: { x: -3, y: 5 }, direction: 12 },
      { entity_number: 14, name: "curved-rail-b", position: { x: -5, y: 3 }, direction: 12 },
      { entity_number: 15, name: "curved-rail-a", position: { x: -5, y: -3 }, direction: 0 },
      { entity_number: 16, name: "curved-rail-b", position: { x: -3, y: -5 }, direction: 0 },
      { entity_number: 17, name: "rail-signal", position: { x: 0, y: -6.5 }, direction: 4 },
    ];
    expect(db.entities["straight-rail"]?.kind).toBe("rail");
    expect(db.entities["curved-rail-a"]?.kind).toBe("rail");
    expect(db.entities["rail-signal"]?.kind).toBe("rail-signal");

    const list = planDrawList(bp(entities), db);
    const layers = new Set(list.commands.filter((c) => c.kind === "sprite").map((c) => c.layer));
    expect(layers.has(RENDER_LAYERS["rail-stone-path-lower"])).toBe(true);
    expect(layers.has(RENDER_LAYERS["rail-stone-path"])).toBe(true);
    expect(layers.has(RENDER_LAYERS["rail-tie"])).toBe(true);
    expect(layers.has(RENDER_LAYERS["rail-screw"])).toBe(true);
    expect(layers.has(RENDER_LAYERS["rail-metal"])).toBe(true);
    const signal = list.commands.find((c) => c.kind === "sprite" && c.entity === 17);
    expect(signal).toBeTruthy();
    assertSnapshot("rail-loop-small", list);
  });

  it("wired-poles: copper chain + red/green cross links", () => {
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "small-electric-pole", position: { x: 0.5, y: 0.5 } },
      { entity_number: 2, name: "small-electric-pole", position: { x: 4.5, y: 0.5 } },
      { entity_number: 3, name: "small-electric-pole", position: { x: 8.5, y: 0.5 } },
    ];
    const wires: Blueprint["wires"] = [
      [1, 5, 2, 5], // copper 1→2
      [2, 5, 3, 5], // copper 2→3
      [1, 1, 3, 1], // red cross
      [1, 2, 3, 2], // green cross
    ];
    const list = planDrawList({ item: "blueprint", version: 2 * 2 ** 48, entities, wires }, db);
    const wireCmds = list.commands.filter((c) => c.kind === "wire");
    expect(wireCmds).toHaveLength(4);
    expect(wireCmds.filter((c) => c.kind === "wire" && c.wire === "copper")).toHaveLength(2);
    expect(wireCmds.filter((c) => c.kind === "wire" && c.wire === "red")).toHaveLength(1);
    expect(wireCmds.filter((c) => c.kind === "wire" && c.wire === "green")).toHaveLength(1);
    // Anchors should not all sit at entity centers (poles have real connection_points).
    const copper = wireCmds.find((c) => c.kind === "wire" && c.wire === "copper");
    expect(copper && copper.kind === "wire" && copper.y1).not.toBe(0.5);
    // Auto-orient from wires: horizontal chain → FBE direction 8 (south art), not north.
    const southFrame =
      db.entities["small-electric-pole"]?.graphics[0]?.variants.default?.[2]?.frame;
    expect(southFrame).toBeTypeOf("number");
    const poleObjects = list.commands.filter(
      (c) =>
        c.kind === "sprite" && c.entity >= 1 && c.entity <= 3 && c.layer === RENDER_LAYERS.object,
    );
    expect(poleObjects.length).toBeGreaterThan(0);
    for (const c of poleObjects) {
      if (c.kind === "sprite") expect(c.frame).toBe(southFrame);
    }
    assertSnapshot("wired-poles", list);
  });

  it("east-facing pole uses direction4 wire anchor key 1 (not direction8 key 2)", () => {
    const entities: BlueprintEntity[] = [
      {
        entity_number: 1,
        name: "small-electric-pole",
        position: { x: 0.5, y: 0.5 },
        direction: 4,
      },
      {
        entity_number: 2,
        name: "small-electric-pole",
        position: { x: 4.5, y: 0.5 },
        direction: 4,
      },
    ];
    const wires: Blueprint["wires"] = [[1, 5, 2, 5]];
    const list = planDrawList({ item: "blueprint", version: 2 * 2 ** 48, entities, wires }, db);
    const copper = list.commands.find((c) => c.kind === "wire" && c.wire === "copper");
    expect(copper && copper.kind === "wire").toBe(true);
    if (!copper || copper.kind !== "wire") return;
    // Anchors[1].copper — east column of direction4 wireAnchors.
    const anchor = (
      db.entities["small-electric-pole"]?.data?.wireAnchors as
        | Record<string, { copper?: [number, number] }>
        | undefined
    )?.["1"]?.copper;
    expect(anchor).toBeTruthy();
    if (!anchor) return;
    expect(copper.x1).toBeCloseTo(0.5 + anchor[0], 3);
    expect(copper.y1).toBeCloseTo(0.5 + anchor[1], 3);
  });

  it("circuit connectors: wired inserter emits CCM sprites; unwired does not", () => {
    const inserter: BlueprintEntity = {
      entity_number: 1,
      name: "inserter",
      position: { x: 0.5, y: 0.5 },
      direction: 4,
    };
    const pole: BlueprintEntity = {
      entity_number: 2,
      name: "small-electric-pole",
      position: { x: 2.5, y: 0.5 },
    };
    const unwired = planDrawList(bp([inserter]), db);
    const wired = planDrawList(
      {
        item: "blueprint",
        version: 2 * 2 ** 48,
        entities: [inserter, pole],
        wires: [[1, 1, 2, 1]], // red
      },
      db,
    );
    const higher = (list: ReturnType<typeof planDrawList>) =>
      list.commands.filter(
        (c) =>
          c.kind === "sprite" && c.entity === 1 && c.layer === RENDER_LAYERS["higher-object-above"],
      );
    // Inserter platform uses floor; hands use lower-object; CCM uses higher-object-above.
    expect(higher(unwired).length).toBe(0);
    // Wired: connector_main + wire_pins + led_blue_off.
    expect(higher(wired).length).toBe(3);
    const shadows = wired.commands.filter(
      (c) => c.kind === "sprite" && c.entity === 1 && c.layer === RENDER_LAYERS.shadow && c.shadow,
    );
    expect(shadows.length).toBeGreaterThanOrEqual(2); // connector_shadow + wire_pins_shadow
    assertSnapshot("wired-inserter-ccm", wired);
  });

  it("belt circuit connectors: wired belt emits cage on layer 35; unwired does not", () => {
    const belt: BlueprintEntity = {
      entity_number: 1,
      name: "transport-belt",
      position: { x: 0.5, y: 0.5 },
      direction: 4, // east → H variation
    };
    const pole: BlueprintEntity = {
      entity_number: 2,
      name: "small-electric-pole",
      position: { x: 2.5, y: 0.5 },
    };
    const unwired = planDrawList(bp([belt]), db);
    const wired = planDrawList(
      {
        item: "blueprint",
        version: 2 * 2 ** 48,
        entities: [belt, pole],
        wires: [[1, 1, 2, 1]], // red
      },
      db,
    );
    const beltConn = (list: ReturnType<typeof planDrawList>) =>
      list.commands.filter(
        (c) =>
          c.kind === "sprite" &&
          c.entity === 1 &&
          c.layer === RENDER_LAYERS["transport-belt-circuit-connector"],
      );
    expect(beltConn(unwired).length).toBe(0);
    // No control_behavior → state 0. Distilled split plates reconstruct that source frame.
    expect(beltConn(wired).length).toBe(5);
    expect(beltConn(wired).some((c) => c.kind === "sprite" && c.shadow === true)).toBe(true);
    const wires = wired.commands.filter((c) => c.kind === "wire");
    expect(wires).toHaveLength(1);
    assertSnapshot("wired-belt-connector", wired);
  });

  it("belt circuit connectors: LEDs gated by input/output control_behavior", () => {
    const pole: BlueprintEntity = {
      entity_number: 2,
      name: "small-electric-pole",
      position: { x: 2.5, y: 0.5 },
    };
    const beltConnCount = (control_behavior?: BlueprintEntity["control_behavior"]) => {
      const belt: BlueprintEntity = {
        entity_number: 1,
        name: "transport-belt",
        position: { x: 0.5, y: 0.5 },
        direction: 4,
        ...(control_behavior ? { control_behavior } : {}),
      };
      const list = planDrawList(
        {
          item: "blueprint",
          version: 2 * 2 ** 48,
          entities: [belt, pole],
          wires: [[1, 1, 2, 1]],
        },
        db,
      );
      return list.commands.filter(
        (c) =>
          c.kind === "sprite" &&
          c.entity === 1 &&
          c.layer === RENDER_LAYERS["transport-belt-circuit-connector"],
      ).length;
    };
    // Each state selects its own cage frame; split plates reconstruct it before LEDs are added.
    expect(beltConnCount()).toBe(5);
    expect(beltConnCount({ circuit_enabled: true })).toBe(7);
    expect(beltConnCount({ circuit_read_hand_contents: true })).toBe(6);
    expect(beltConnCount({ circuit_enabled: true, circuit_read_hand_contents: true })).toBe(8);
    // Legacy enable_disable alias
    expect(beltConnCount({ circuit_enable_disable: true })).toBe(7);
  });

  it("belt circuit connectors: fixture frame follows behavior state, not belt direction", () => {
    const pole: BlueprintEntity = {
      entity_number: 2,
      name: "small-electric-pole",
      position: { x: 2.5, y: 0.5 },
    };
    const frameRows = (
      db.entities["transport-belt"]?.data?.beltConnectorGraphics as {
        layers?: { frame_main?: ({ frame: number } | null)[][] };
      }
    ).layers?.frame_main;
    expect(frameRows).toBeTruthy();

    const plannedFrames = (
      direction: number,
      control_behavior?: BlueprintEntity["control_behavior"],
    ) => {
      const belt: BlueprintEntity = {
        entity_number: 1,
        name: "transport-belt",
        position: { x: 0.5, y: 0.5 },
        direction,
        ...(control_behavior ? { control_behavior } : {}),
      };
      return planDrawList(
        {
          item: "blueprint",
          version: 2 * 2 ** 48,
          entities: [belt, pole],
          wires: [[1, 1, 2, 1]],
        },
        db,
      ).commands.flatMap((c) => (c.kind === "sprite" && c.entity === 1 ? [c.frame] : []));
    };

    // East and west are the same H topology. Direction must not select state 1 or 3.
    expect(plannedFrames(4)).toContain(frameRows?.[1]?.[0]?.frame);
    expect(plannedFrames(12)).toContain(frameRows?.[1]?.[0]?.frame);
    expect(plannedFrames(12, { circuit_read_hand_contents: true })).toContain(
      frameRows?.[1]?.[2]?.frame,
    );
  });

  it("entire_belt_hold: reader skirts on the transport line, not on a mere wired belt", () => {
    const reader: BlueprintEntity = {
      entity_number: 1,
      name: "transport-belt",
      position: { x: 1.5, y: 0.5 },
      direction: 4,
      control_behavior: {
        circuit_read_hand_contents: true,
        circuit_contents_read_mode: 2, // entire_belt_hold
      },
    };
    const neighbor: BlueprintEntity = {
      entity_number: 2,
      name: "transport-belt",
      position: { x: 0.5, y: 0.5 },
      direction: 4,
    };
    const pole: BlueprintEntity = {
      entity_number: 3,
      name: "small-electric-pole",
      position: { x: 3.5, y: 0.5 },
    };
    const wiredOnly: BlueprintEntity = {
      entity_number: 4,
      name: "transport-belt",
      position: { x: 0.5, y: 2.5 },
      direction: 4,
    };
    const list = planDrawList(
      {
        item: "blueprint",
        version: 2 * 2 ** 48,
        entities: [reader, neighbor, pole, wiredOnly],
        wires: [
          [1, 1, 3, 1],
          [4, 1, 3, 1],
        ],
      },
      db,
    );
    const readerSprites = (entity: number) =>
      list.commands.filter(
        (c) =>
          c.kind === "sprite" &&
          c.entity === entity &&
          (c.layer === RENDER_LAYERS["transport-belt-reader"] ||
            c.layer === RENDER_LAYERS["floor-mechanics"] ||
            c.layer === RENDER_LAYERS["transport-belt-endings"] ||
            c.layer === RENDER_LAYERS.floor),
      );
    // Reader + neighbor on the line get skirts (floor and/or reader layers).
    expect(readerSprites(1).length).toBeGreaterThan(0);
    expect(readerSprites(2).length).toBeGreaterThan(0);
    // Wired-only belt (no entire_belt_hold) is not on the reader line — CCM cage only.
    const wiredOnlyFloor = list.commands.filter(
      (c) => c.kind === "sprite" && c.entity === 4 && c.layer === RENDER_LAYERS.floor,
    );
    expect(wiredOnlyFloor.length).toBe(0);
    assertSnapshot("belt-reader-entire-hold", list);
  });

  it("train-on-rails: straight segment + loco + wagon", () => {
    const entities: BlueprintEntity[] = [
      { entity_number: 1, name: "straight-rail", position: { x: 0, y: -2 }, direction: 0 },
      { entity_number: 2, name: "straight-rail", position: { x: 0, y: 0 }, direction: 0 },
      { entity_number: 3, name: "straight-rail", position: { x: 0, y: 2 }, direction: 0 },
      {
        entity_number: 4,
        name: "locomotive",
        position: { x: 0, y: -1 },
        orientation: 0.25,
      },
      {
        entity_number: 5,
        name: "cargo-wagon",
        position: { x: 0, y: 3 },
        orientation: 0.25,
      },
    ];
    expect(db.entities.locomotive?.kind).toBe("train");
    expect(db.entities["cargo-wagon"]?.kind).toBe("train");
    expect(db.entities.locomotive?.graphics.some((g) => g.layer === "object")).toBe(true);
    expect(typeof db.entities.locomotive?.data?.colorMaskGroupIndex).toBe("number");
    const n = db.entities.locomotive?.data?.orientationCount as number;
    expect(n).toBeGreaterThan(0);

    const resolved = resolve(bp(entities), db);
    const loco = resolved.find((r) => r.entity.entity_number === 4);
    const expected = Math.round(0.25 * n) % n;
    // Body/mask/shadow use projected orientation; east (0.25) projects near itself.
    expect(loco?.selections.some((s) => s.group === 1 && s.index === expected)).toBe(true);
    const wheelSel = loco?.selections.filter((s) => s.group === 0) ?? [];
    expect(wheelSel).toHaveLength(2);
    expect(wheelSel[0]?.shift?.[0]).toBeCloseTo(2, 5);
    expect(wheelSel[1]?.shift?.[0]).toBeCloseTo(-2, 5);
    expect(wheelSel[0]?.shift?.[1]).toBeCloseTo(-0.25, 5);
    // Eastbound: forward bogie uses orientation+0.5 (west pose) so coupler faces out.
    const wheelN =
      (db.entities.locomotive?.data?.orientationCount as number) ??
      db.entities.locomotive?.graphics[0]?.variants.default?.length ??
      64;
    expect(wheelSel[0]?.index).toBe(Math.round(0.75 * wheelN) % wheelN);
    expect(wheelSel[1]?.index).toBe(Math.round(0.25 * wheelN) % wheelN);
    // Body/mask/shadow also get the eastbound rail-shift.
    expect(loco?.selections.some((s) => s.group === 1 && s.shift?.[1] === -0.25)).toBe(true);

    const list = planDrawList(bp(entities), db);
    expect(list.commands.some((c) => c.kind === "sprite" && c.entity === 4)).toBe(true);
    expect(list.commands.some((c) => c.kind === "sprite" && c.entity === 5)).toBe(true);
    const locoWheelCmds = list.commands.filter(
      (c) =>
        c.kind === "sprite" && c.entity === 4 && c.layer === RENDER_LAYERS.object && c.sub === 0,
    );
    expect(locoWheelCmds).toHaveLength(2);
    const locoTinted = list.commands.filter(
      (c) => c.kind === "sprite" && c.entity === 4 && c.tint != null,
    );
    expect(locoTinted.length).toBeGreaterThan(0);
    expect(locoTinted[0]?.kind === "sprite" && locoTinted[0].tint?.[0]).toBeCloseTo(0.92, 5);
    // Loco @ y=-1 and wagon @ y=3 are not coupled (wrong axis for east orientation).
    expect(list.commands.some((c) => c.kind === "train-chain")).toBe(false);
    assertSnapshot("train-on-rails", list);
  });

  it("train-chain: coupled loco + wagon emits green joint overlay", () => {
    const entities: BlueprintEntity[] = [
      {
        entity_number: 1,
        name: "locomotive",
        position: { x: 0, y: 0 },
        orientation: 0.25,
      },
      {
        entity_number: 2,
        name: "cargo-wagon",
        position: { x: 7, y: 0 },
        orientation: 0.25,
      },
    ];
    const list = planDrawList(
      {
        item: "blueprint",
        version: 2 * 2 ** 48,
        entities,
        stock_connections: [
          { stock: 1, front: 2 },
          { stock: 2, back: 1 },
        ],
      },
      db,
      { altMode: false },
    );
    const chain = list.commands.find((c) => c.kind === "train-chain");
    expect(chain).toBeDefined();
    if (chain?.kind !== "train-chain") throw new Error("expected train-chain");
    expect(chain.joints).toHaveLength(2);
    expect(chain.segments).toHaveLength(1);
    expect(chain.layer).toBe(RENDER_LAYERS["selection-box"]);
    assertSnapshot("train-chain", list);
  });

  it("train-stop south of loco: top above trains, bottom sorts after loco", () => {
    const stop = db.entities["train-stop"];
    expect(stop?.graphics.some((g) => g.layer === "train-stop-top")).toBe(true);
    expect(stop?.graphics.some((g) => g.layer === "rail-screw")).toBe(true);
    expect(typeof stop?.data?.colorMaskGroupIndex).toBe("number");

    const entities: BlueprintEntity[] = [
      {
        entity_number: 1,
        name: "locomotive",
        position: { x: 0, y: 0 },
        orientation: 0.25,
      },
      {
        entity_number: 2,
        name: "train-stop",
        position: { x: 2, y: 2 },
        direction: 4,
      },
    ];
    const list = planDrawList(bp(entities), db);
    const locoObj = list.commands.filter(
      (c) => c.kind === "sprite" && c.entity === 1 && c.layer === RENDER_LAYERS.object,
    );
    const stopObj = list.commands.filter(
      (c) => c.kind === "sprite" && c.entity === 2 && c.layer === RENDER_LAYERS.object,
    );
    const stopTop = list.commands.filter(
      (c) => c.kind === "sprite" && c.entity === 2 && c.layer === RENDER_LAYERS["train-stop-top"],
    );
    expect(locoObj.length).toBeGreaterThan(0);
    expect(stopObj.length).toBeGreaterThan(0);
    expect(stopTop.length).toBeGreaterThanOrEqual(2);
    // Rolling stock sorts by position.y; stop collision south edge is further south.
    expect(stopObj[0]!.sortY).toBeGreaterThan(locoObj[0]!.sortY);
    expect(RENDER_LAYERS["train-stop-top"]).toBeGreaterThan(RENDER_LAYERS.object);
    expect(stopTop.some((c) => c.kind === "sprite" && c.tint != null)).toBe(true);
  });

  it("artillery-wagon includes cannon barrel and base groups", () => {
    const arty = db.entities["artillery-wagon"];
    expect(arty?.kind).toBe("train");
    expect(Array.isArray(arty?.data?.cannonGroupIndices)).toBe(true);
    expect((arty?.data?.cannonGroupIndices as number[]).length).toBeGreaterThanOrEqual(2);
    expect(typeof arty?.data?.cannonBaseHeight).toBe("number");
    const resolved = resolve(
      bp([
        {
          entity_number: 1,
          name: "artillery-wagon",
          position: { x: 0, y: 0 },
          orientation: 0.25,
        },
      ]),
      db,
    )[0];
    const cannonIdxs = new Set(arty?.data?.cannonGroupIndices as number[]);
    const cannonSels = resolved?.selections.filter((s) => cannonIdxs.has(s.group)) ?? [];
    expect(cannonSels.length).toBeGreaterThanOrEqual(2);
    // East-facing mount: negative X offset + height flatten (see artilleryCannonShift).
    expect(cannonSels[0]?.shift?.[0]).toBeCloseTo(-2.0702, 3);
    expect(cannonSels.every((s) => (s.shift?.[1] ?? 0) < -1)).toBe(true);
  });

  it("cargo-wagon back_equals_front: east and west share horizontal body pose", () => {
    expect(db.entities["cargo-wagon"]?.data?.backEqualsFront).toBe(true);
    expect(db.entities["fluid-wagon"]?.data?.backEqualsFront).toBe(true);
    const east = resolve(
      bp([{ entity_number: 1, name: "cargo-wagon", position: { x: 0, y: 0 }, orientation: 0.25 }]),
      db,
    )[0];
    const west = resolve(
      bp([{ entity_number: 1, name: "cargo-wagon", position: { x: 0, y: 0 }, orientation: 0.75 }]),
      db,
    )[0];
    const eastBody = east?.selections.find((s) => s.group === 1)?.index;
    const westBody = west?.selections.find((s) => s.group === 1)?.index;
    expect(eastBody).toBe(32);
    expect(westBody).toBe(32);
    // Wheels stay full-circle; forward bogie is orientation+0.5 (outward coupler).
    const eastWheels = east?.selections.filter((s) => s.group === 0).map((s) => s.index);
    const westWheels = west?.selections.filter((s) => s.group === 0).map((s) => s.index);
    expect(eastWheels).toEqual([48, 16]);
    expect(westWheels).toEqual([16, 48]);
  });
});
