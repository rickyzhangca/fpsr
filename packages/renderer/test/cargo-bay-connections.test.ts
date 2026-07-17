import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { _cargoBayConnectionsTest, emitCargoBayConnections } from "../src/cargo-bay-connections.js";
import { planDrawList } from "../src/plan.js";
import { blueprintPrefersPlatformGraphics } from "../src/resolve.js";
import type { Blueprint } from "../src/types/blueprint.js";
import { RENDER_LAYERS } from "../src/types/draw-list.js";
import type { RenderDb } from "../src/types/render-db.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_DB = path.join(ROOT, "fixtures/render-db/2.1.11.json");

function loadFixtureDb(): RenderDb {
  return JSON.parse(readFileSync(FIXTURE_DB, "utf8")) as RenderDb;
}

describe("cargo-bay connections", () => {
  it("prefers platform graphics when a hub or space-platform tile is present", () => {
    expect(
      blueprintPrefersPlatformGraphics({
        item: "blueprint",
        version: 281479276527616,
        entities: [{ entity_number: 1, name: "cargo-bay", position: { x: 0, y: 0 } }],
      }),
    ).toBe(false);
    expect(
      blueprintPrefersPlatformGraphics({
        item: "blueprint",
        version: 281479276527616,
        entities: [
          { entity_number: 1, name: "space-platform-hub", position: { x: 0, y: 0 } },
          { entity_number: 2, name: "cargo-bay", position: { x: 6, y: 0 } },
        ],
      }),
    ).toBe(true);
    expect(
      blueprintPrefersPlatformGraphics({
        item: "blueprint",
        version: 281479276527616,
        entities: [{ entity_number: 1, name: "cargo-bay", position: { x: 0, y: 0 } }],
        tiles: [{ name: "space-platform-foundation", position: { x: 0, y: 0 } }],
      }),
    ).toBe(true);
  });

  it("computes 8-neighbor occupancy masks clockwise from top-left", () => {
    const occ = new Set(["0,-1", "1,0"]); // north + east
    // bits: 1 (north) + 3 (east) = 0b00001010 = 10
    expect(_cargoBayConnectionsTest.occupancyMask(occ, 0, 0)).toBe((1 << 1) | (1 << 3));
  });

  it("maps entity footprints onto the forced 2x2 cargo connection grid", () => {
    const db = loadFixtureDb();
    const bay = db.entities["cargo-bay"]!;
    const hub = db.entities["space-platform-hub"]!;

    const bayCells = _cargoBayConnectionsTest.footprintCells(
      { entity_number: 1, name: "cargo-bay", position: { x: 0, y: 0 } },
      bay,
    );
    expect(bayCells).toEqual([
      { gridX: -1, gridY: -1, x: -1, y: -1 },
      { gridX: 0, gridY: -1, x: 1, y: -1 },
      { gridX: -1, gridY: 0, x: -1, y: 1 },
      { gridX: 0, gridY: 0, x: 1, y: 1 },
    ]);

    const hubCells = _cargoBayConnectionsTest.footprintCells(
      { entity_number: 1, name: "space-platform-hub", position: { x: 0, y: 0 } },
      hub,
    );
    expect(hubCells).toHaveLength(16);
    expect(new Set(hubCells.map((cell) => cell.x))).toEqual(new Set([-3, -1, 1, 3]));
    expect(new Set(hubCells.map((cell) => cell.y))).toEqual(new Set([-3, -1, 1, 3]));
  });

  it("emits perimeter sprites for a standalone cargo-bay", () => {
    const db = loadFixtureDb();
    const bp: Blueprint = {
      item: "blueprint",
      version: 281479276527616,
      entities: [{ entity_number: 1, name: "cargo-bay", position: { x: 0, y: 0 } }],
      tiles: [{ name: "space-platform-foundation", position: { x: 0, y: 0 } }],
    };

    const commands: ReturnType<typeof planDrawList>["commands"] = [];
    emitCargoBayConnections(bp, db, true, commands);
    expect(commands.length).toBeGreaterThan(0);
    expect(new Set(commands.map((command) => command.layer)).size).toBeGreaterThan(1);
  });

  it("emits connection sprites for adjacent hub and cargo-bay", () => {
    const db = loadFixtureDb();
    // Skip if fixture not yet rebuilt with connection data.
    const bay = db.entities["cargo-bay"];
    const hub = db.entities["space-platform-hub"];
    if (!bay?.data?.cargoBayConnectionsPlatform && !bay?.data?.cargoBayConnections) {
      return;
    }
    if (!hub?.data?.cargoBayConnections && !hub?.data?.cargoBayConnectionsPlatform) {
      return;
    }

    const bp: Blueprint = {
      item: "blueprint",
      version: 281479276527616,
      entities: [
        { entity_number: 1, name: "space-platform-hub", position: { x: 0, y: 0 } },
        // Hub is 8×8 ([-4,-4]..[4,4]); bay 4×4 — place bay on east edge.
        { entity_number: 2, name: "cargo-bay", position: { x: 6, y: 0 } },
      ],
      tiles: [{ name: "space-platform-foundation", position: { x: 0, y: 0 } }],
    };

    const list = planDrawList(bp, db);
    const lower = list.commands.filter(
      (c) =>
        c.kind === "sprite" &&
        (c.layer === RENDER_LAYERS["lower-object-above-shadow"] ||
          c.layer === RENDER_LAYERS["lower-object-overlay"] ||
          c.layer === RENDER_LAYERS["object-under"]),
    );
    expect(lower.length).toBeGreaterThan(0);

    const commands: typeof list.commands = [];
    emitCargoBayConnections(bp, db, true, commands);
    expect(commands.length).toBeGreaterThan(0);
  });
});
