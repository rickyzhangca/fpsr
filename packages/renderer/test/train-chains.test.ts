import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { buildTrainChainGeometry, trainJointWorldPoints } from "../src/train-chains.js";
import type { Blueprint, BlueprintEntity } from "../src/types/blueprint.js";
import type { EntityRenderDef, RenderDb } from "../src/types/render-db.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const db = JSON.parse(
  readFileSync(path.join(ROOT, "fixtures/render-db/2.1.9.json"), "utf8"),
) as RenderDb;

function trainDef(name: string): EntityRenderDef {
  const def = db.entities[name];
  if (!def || def.kind !== "train") throw new Error(`missing train ${name}`);
  return def;
}

function byNumber(
  entities: BlueprintEntity[],
): Map<number, { entity: BlueprintEntity; def: EntityRenderDef }> {
  const m = new Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>();
  for (const entity of entities) {
    m.set(entity.entity_number, { entity, def: trainDef(entity.name) });
  }
  return m;
}

describe("trainJointWorldPoints", () => {
  it("places east-facing joints at ±joint/2 with rail-shift Y", () => {
    const entity: BlueprintEntity = {
      entity_number: 1,
      name: "locomotive",
      position: { x: 10, y: 5 },
      orientation: 0.25,
    };
    const j = trainJointWorldPoints(entity, 4);
    expect(j.front[0]).toBeCloseTo(12, 5);
    expect(j.back[0]).toBeCloseTo(8, 5);
    expect(j.front[1]).toBeCloseTo(4.75, 5);
    expect(j.back[1]).toBeCloseTo(4.75, 5);
  });

  it("places north-facing joints along −Y", () => {
    const entity: BlueprintEntity = {
      entity_number: 1,
      name: "locomotive",
      position: { x: 0, y: 0 },
      orientation: 0,
    };
    const j = trainJointWorldPoints(entity, 4);
    expect(j.front[0]).toBeCloseTo(0, 5);
    expect(j.front[1]).toBeCloseTo(-2, 5);
    expect(j.back[0]).toBeCloseTo(0, 5);
    expect(j.back[1]).toBeCloseTo(2, 5);
  });
});

describe("buildTrainChainGeometry", () => {
  it("builds joints and segments from stock_connections (L–C–L)", () => {
    // Eastbound: loco @0, cargo @7, reverse loco @14. Centers 7 tiles apart.
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
      {
        entity_number: 3,
        name: "locomotive",
        position: { x: 14, y: 0 },
        orientation: 0.75, // faces west (rear loco)
      },
    ];
    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities,
      stock_connections: [
        // Eastbound lead loco: front joint couples to cargo behind it.
        { stock: 1, front: 2 },
        { stock: 2, back: 1, front: 3 },
        // West-facing rear loco: front joint couples to cargo.
        { stock: 3, front: 2 },
      ],
    };
    const geom = buildTrainChainGeometry(bp, byNumber(entities));
    expect(geom).not.toBeNull();
    // L–C–L: 2 couplings × 2 joints each (free outer ends omitted)
    expect(geom!.joints).toHaveLength(4);
    expect(geom!.segments).toHaveLength(2);
    // Center-to-center gap is 3; strokes inset by joint radius on each end.
    for (const s of geom!.segments) {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      expect(len).toBeCloseTo(3 - 2 * 0.3, 4);
    }
  });

  it("infers coupling from proximity when stock_connections is absent", () => {
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
    const bp: Blueprint = { item: "blueprint", version: 2 * 2 ** 48, entities };
    const geom = buildTrainChainGeometry(bp, byNumber(entities));
    expect(geom).not.toBeNull();
    // One coupling → 2 joints, 1 segment (outer ends skipped)
    expect(geom!.joints).toHaveLength(2);
    expect(geom!.segments).toHaveLength(1);
  });

  it("returns null for isolated rolling stock", () => {
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
        position: { x: 0, y: 20 },
        orientation: 0.25,
      },
    ];
    const bp: Blueprint = { item: "blueprint", version: 2 * 2 ** 48, entities };
    expect(buildTrainChainGeometry(bp, byNumber(entities))).toBeNull();
  });
});
