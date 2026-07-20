import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { planDrawList } from "../src/plan/index.js";
import { resolve } from "../src/resolve.js";
import { activeFluidOffsets, activeFluidPorts } from "../src/resolve/fluid-ports.js";
import type { Blueprint, BlueprintEntity } from "../src/types/blueprint.js";
import type { RenderDb } from "../src/types/render-db.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const db = JSON.parse(
  readFileSync(path.join(ROOT, "fixtures/render-db/2.1.11.json"), "utf8"),
) as RenderDb;

function bp(entities: BlueprintEntity[]): Blueprint {
  return { item: "blueprint", version: 2 * 2 ** 48, entities };
}

function coverFrames(entityNumber: number, list: ReturnType<typeof planDrawList>): number[] {
  return list.commands
    .filter((c) => c.kind === "sprite" && c.entity === entityNumber && c.sub === 81)
    .map((c) => (c.kind === "sprite" ? c.frame : -1));
}

function pictureFrames(entityNumber: number, list: ReturnType<typeof planDrawList>): number[] {
  return list.commands
    .filter((c) => c.kind === "sprite" && c.entity === entityNumber && c.sub === 71)
    .map((c) => (c.kind === "sprite" ? c.frame : -1));
}

describe("assembler fluid-box recipe gating", () => {
  it("distills fluidRecipes and AM2 connection roles in the fixture DB", () => {
    expect(db.fluidRecipes?.concrete).toEqual({ ingredients: true, products: false });
    expect(db.fluidRecipes?.["sulfuric-acid"]).toEqual({ ingredients: true, products: true });
    expect(db.fluidRecipes?.["iron-gear-wheel"]).toBeUndefined();

    const am2 = db.entities["assembling-machine-2"]!;
    expect(am2.data?.fluidBoxesRequireFluidRecipe).toBe(true);
    expect(am2.data?.fluidConnectionRoles?.["0"]).toEqual(["input", "output"]);
    expect(am2.data?.fluidConnectionFlows?.["0"]).toEqual(["input", "output"]);
    expect(am2.data?.fluidConnectionFacings?.["0"]).toEqual([0, 8]);
    expect(db.entities["chemical-plant"]?.data?.fluidBoxesRequireFluidRecipe).toBeUndefined();
  });

  it("activeFluidPorts: recipe gate + hide_connection_info", () => {
    const am2 = db.entities["assembling-machine-2"]!;
    const base: BlueprintEntity = {
      entity_number: 1,
      name: "assembling-machine-2",
      position: { x: 0.5, y: 0.5 },
      direction: 0,
    };
    expect(activeFluidPorts(base, am2, db)).toEqual([]);
    expect(activeFluidPorts({ ...base, recipe: "concrete" }, am2, db)).toEqual([
      { offset: [0, -2], flow: "input", facing: 0 },
    ]);

    const pump = db.entities["pump"]!;
    const pumpPorts = activeFluidPorts(
      { entity_number: 1, name: "pump", position: { x: 0.5, y: 0.5 } },
      pump,
      db,
    );
    expect(pumpPorts).toHaveLength(1);
    expect(pumpPorts[0]?.flow).toBe("output");
    // Covers still see both openings (hide only affects indication arrows).
    expect(
      activeFluidOffsets(
        { entity_number: 1, name: "pump", position: { x: 0.5, y: 0.5 } },
        pump,
        db,
      ),
    ).toHaveLength(2);
  });

  it("activeFluidOffsets: no recipe / non-fluid recipe → none; concrete → input only", () => {
    const def = db.entities["assembling-machine-2"]!;
    const base: BlueprintEntity = {
      entity_number: 1,
      name: "assembling-machine-2",
      position: { x: 0.5, y: 0.5 },
      direction: 0,
    };
    expect(activeFluidOffsets(base, def, db)).toEqual([]);
    expect(activeFluidOffsets({ ...base, recipe: "iron-gear-wheel" }, def, db)).toEqual([]);
    expect(activeFluidOffsets({ ...base, recipe: "concrete" }, def, db)).toEqual([[0, -2]]);
    expect(activeFluidOffsets({ ...base, recipe: "sulfuric-acid" }, def, db)).toEqual([
      [0, -2],
      [0, 2],
    ]);
  });

  it("pipe covers: AM2 without recipe or with non-fluid recipe emits none", () => {
    const none = planDrawList(
      bp([{ entity_number: 1, name: "assembling-machine-2", position: { x: 0.5, y: 0.5 } }]),
      db,
    );
    expect(coverFrames(1, none)).toHaveLength(0);

    const gear = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "assembling-machine-2",
          position: { x: 0.5, y: 0.5 },
          recipe: "iron-gear-wheel",
        },
      ]),
      db,
    );
    expect(coverFrames(1, gear)).toHaveLength(0);
  });

  it("pipe covers: concrete activates input only; sulfuric-acid both", () => {
    const concrete = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "assembling-machine-2",
          position: { x: 0.5, y: 0.5 },
          recipe: "concrete",
        },
      ]),
      db,
    );
    expect(coverFrames(1, concrete)).toHaveLength(1);

    const acid = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "assembling-machine-2",
          position: { x: 0.5, y: 0.5 },
          recipe: "sulfuric-acid",
        },
      ]),
      db,
    );
    expect(coverFrames(1, acid)).toHaveLength(2);
  });

  it("pipe covers: chemical-plant always emits covers (flag unset)", () => {
    const list = planDrawList(
      bp([{ entity_number: 1, name: "chemical-plant", position: { x: 0.5, y: 0.5 } }]),
      db,
    );
    expect(coverFrames(1, list).length).toBeGreaterThan(0);
  });

  it("pipes do not joint to AM2 without a fluid recipe", () => {
    const entities: BlueprintEntity[] = [
      {
        entity_number: 1,
        name: "assembling-machine-2",
        position: { x: 0.5, y: 0.5 },
        direction: 0,
        recipe: "iron-gear-wheel",
      },
      // AM2 north port at [0,-2] → pipe tile (0.5, -1.5)
      { entity_number: 2, name: "pipe", position: { x: 0.5, y: -1.5 } },
    ];
    const resolved = resolve(bp(entities), db).entities;
    const pipe = resolved.find((r) => r.entity.entity_number === 2);
    expect(pipe?.selections[0]?.variantKey).toBe("0000");
  });

  it("pipes joint to AM2 when recipe needs fluid input", () => {
    const entities: BlueprintEntity[] = [
      {
        entity_number: 1,
        name: "assembling-machine-2",
        position: { x: 0.5, y: 0.5 },
        direction: 0,
        recipe: "concrete",
      },
      { entity_number: 2, name: "pipe", position: { x: 0.5, y: -1.5 } },
    ];
    const resolved = resolve(bp(entities), db).entities;
    const pipe = resolved.find((r) => r.entity.entity_number === 2);
    // South side of pipe faces the assembler.
    expect(pipe?.selections[0]?.variantKey).toBe("0010");
  });

  it("foundry: no recipe / non-fluid recipe hides pipe WV groups", () => {
    const foundry = db.entities.foundry!;
    expect(foundry.data?.fluidWorkingVisualisationGroups).toEqual({
      input: [4],
      output: [3],
    });
    const base: BlueprintEntity = {
      entity_number: 1,
      name: "foundry",
      position: { x: 0.5, y: 0.5 },
      direction: 0,
    };
    const none = resolve(bp([base]), db).entities[0]!;
    expect(none.selections.map((s) => s.group)).not.toContain(3);
    expect(none.selections.map((s) => s.group)).not.toContain(4);

    const gear = resolve(bp([{ ...base, recipe: "iron-gear-wheel" }]), db).entities[0]!;
    expect(gear.selections.map((s) => s.group)).not.toContain(3);
    expect(gear.selections.map((s) => s.group)).not.toContain(4);
  });

  it("foundry: casting-iron shows input pipes only; molten-iron-from-lava shows both", () => {
    const base: BlueprintEntity = {
      entity_number: 1,
      name: "foundry",
      position: { x: 0.5, y: 0.5 },
      direction: 0,
    };
    const casting = resolve(bp([{ ...base, recipe: "casting-iron" }]), db).entities[0]!;
    const castingGroups = casting.selections.map((s) => s.group);
    expect(castingGroups).toContain(4);
    expect(castingGroups).not.toContain(3);

    const lava = resolve(bp([{ ...base, recipe: "molten-iron-from-lava" }]), db).entities[0]!;
    const lavaGroups = lava.selections.map((s) => s.group);
    expect(lavaGroups).toContain(3);
    expect(lavaGroups).toContain(4);

    const melting = resolve(bp([{ ...base, recipe: "ice-melting" }]), db).entities[0]!;
    const meltingGroups = melting.selections.map((s) => s.group);
    expect(meltingGroups).toContain(3);
    expect(meltingGroups).not.toContain(4);
  });

  it("pipe pictures: AM2 fixture has per-port stubs; foundry has none", () => {
    const am2 = db.entities["assembling-machine-2"]!;
    const pics = am2.data?.pipePictures;
    expect(pics).toHaveLength(2);
    expect(pics?.[0]?.covers.filter(Boolean)).toHaveLength(4);
    expect(pics?.[1]?.covers.filter(Boolean)).toHaveLength(4);
    // Same Sprite4Way on both boxes → shared frame ids.
    expect(pics?.[0]?.covers[0]?.frame).toBe(pics?.[1]?.covers[0]?.frame);
    expect(db.entities.foundry?.data?.pipePictures).toBeUndefined();
  });

  it("pipe pictures: recipe-gated; still drawn when a pipe is connected", () => {
    const none = planDrawList(
      bp([{ entity_number: 1, name: "assembling-machine-2", position: { x: 0.5, y: 0.5 } }]),
      db,
    );
    expect(pictureFrames(1, none)).toHaveLength(0);

    const gear = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "assembling-machine-2",
          position: { x: 0.5, y: 0.5 },
          recipe: "iron-gear-wheel",
        },
      ]),
      db,
    );
    expect(pictureFrames(1, gear)).toHaveLength(0);

    const concrete = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "assembling-machine-2",
          position: { x: 0.5, y: 0.5 },
          recipe: "concrete",
        },
      ]),
      db,
    );
    expect(pictureFrames(1, concrete)).toHaveLength(1);
    expect(coverFrames(1, concrete)).toHaveLength(1);

    // North port uses the north Sprite4Way leaf (pipe-N), not south.
    const am2 = db.entities["assembling-machine-2"]!;
    const northLeaf = am2.data?.pipePictures?.[0]?.covers[0];
    const southLeaf = am2.data?.pipePictures?.[0]?.covers[2];
    expect(northLeaf?.frame).toBeDefined();
    expect(pictureFrames(1, concrete)[0]).toBe(northLeaf!.frame);
    expect(pictureFrames(1, concrete)[0]).not.toBe(southLeaf!.frame);

    // Pipe-tile draw: stub near the north opening (y≈-1.5).
    const stub = concrete.commands.find(
      (c) => c.kind === "sprite" && c.entity === 1 && c.sub === 71,
    );
    expect(stub?.kind).toBe("sprite");
    const stubSprite = stub as Extract<NonNullable<typeof stub>, { kind: "sprite" }>;
    const midY = stubSprite.y + stubSprite.h / 2;
    expect(midY).toBeLessThan(-0.5);
    expect(midY).toBeGreaterThan(-2);

    // Output-only / both-fluid recipe: south port gets pipe-S at the south tile.
    const acid = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "assembling-machine-2",
          position: { x: 0.5, y: 0.5 },
          recipe: "sulfuric-acid",
        },
      ]),
      db,
    );
    expect(pictureFrames(1, acid)).toHaveLength(2);
    expect(pictureFrames(1, acid)).toContain(southLeaf!.frame);
    const southStub = acid.commands.find(
      (c) => c.kind === "sprite" && c.entity === 1 && c.sub === 71 && c.frame === southLeaf!.frame,
    );
    expect(southStub?.kind).toBe("sprite");
    const southStubSprite = southStub as Extract<NonNullable<typeof southStub>, { kind: "sprite" }>;
    const southMidY = southStubSprite.y + southStubSprite.h / 2;
    expect(southMidY).toBeGreaterThan(1);
    expect(southMidY).toBeLessThan(2.5);

    const connected = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "assembling-machine-2",
          position: { x: 0.5, y: 0.5 },
          recipe: "concrete",
        },
        { entity_number: 2, name: "pipe", position: { x: 0.5, y: -1.5 } },
      ]),
      db,
    );
    // Stub remains; cover suppressed when pipe occupies the port.
    expect(pictureFrames(1, connected)).toHaveLength(1);
    expect(coverFrames(1, connected)).toHaveLength(0);
  });

  it("pipe covers: pump always draws north cover above pipe, under pump body", () => {
    // Factorio default: always_draw_covers=true when no pipe_picture (pump art is pre-cropped).
    // Covers y-sort at the pipe tile so north caps don't paint over the bellows.
    const pump = db.entities.pump!;
    expect(pump.data?.pipePictures).toBeUndefined();

    const list = planDrawList(
      bp([
        { entity_number: 1, name: "pump", position: { x: 0.5, y: 0.5 }, direction: 0 },
        { entity_number: 2, name: "pipe", position: { x: 0.5, y: -1.0 } },
      ]),
      db,
    );
    const northCover = list.commands.find(
      (c) => c.kind === "sprite" && c.entity === 1 && c.sub === 81 && c.y + c.h / 2 < 0,
    );
    expect(northCover?.kind).toBe("sprite");
    const pipe = list.commands.find(
      (c) => c.kind === "sprite" && c.entity === 2 && !c.shadow && c.sub !== 80 && c.sub !== 81,
    );
    const body = list.commands.find(
      (c) => c.kind === "sprite" && c.entity === 1 && c.sub === 0 && !c.shadow,
    );
    expect(pipe?.kind).toBe("sprite");
    expect(body?.kind).toBe("sprite");
    const coverSprite = northCover as Extract<NonNullable<typeof northCover>, { kind: "sprite" }>;
    const pipeSprite = pipe as Extract<NonNullable<typeof pipe>, { kind: "sprite" }>;
    const bodySprite = body as Extract<NonNullable<typeof body>, { kind: "sprite" }>;
    expect(coverSprite.sortY).toBeGreaterThan(pipeSprite.sortY);
    expect(coverSprite.sortY).toBeLessThan(bodySprite.sortY);
  });

  it("pipe pictures: cryogenic plant pipe-tile + facing cancels to entity center", () => {
    const cryo = db.entities["cryogenic-plant"]!;
    const westLeaf = cryo.data?.pipePictures?.[1]?.covers[3];
    const eastLeaf = cryo.data?.pipePictures?.[1]?.covers[1];
    expect(westLeaf?.shift[0]).toBeGreaterThan(2);
    expect(eastLeaf?.shift[0]).toBeLessThan(-2);

    // Entity facing east: inputs on west (facing 12), center input has pipe_picture.
    expect(db.fluidRecipes?.lithium).toEqual({ ingredients: true, products: false });
    const list = planDrawList(
      bp([
        {
          entity_number: 1,
          name: "cryogenic-plant",
          position: { x: 0.5, y: 0.5 },
          direction: 4,
          recipe: "lithium",
        },
      ]),
      db,
    );
    const stubs = list.commands.filter(
      (c) => c.kind === "sprite" && c.entity === 1 && c.sub === 71,
    );
    expect(stubs.length).toBeGreaterThan(0);
    // West leaf at pipe tile (-3,0) + shift +3 → sprite center near entity center (x≈0.5).
    expect(pictureFrames(1, list)).toContain(westLeaf!.frame);
    for (const stub of stubs) {
      if (stub.kind !== "sprite") continue;
      const midX = stub.x + stub.w / 2;
      // Must not sit several tiles west of the plant (old opposite+center bug).
      expect(Math.abs(midX - 0.5)).toBeLessThan(1.5);
    }
  });
});
