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
});
