import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { selectDeconstructionPlanner } from "../src/book.js";
import { decode } from "../src/decode.js";
import {
  planDeconstructionPlannerDrawList,
  TREES_AND_ROCKS_ICON_KEY,
} from "../src/plan/deconstruction-planner.js";
import { RENDER_LAYERS } from "../src/types/draw-list.js";
import type { RenderDb } from "../src/types/render-db.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const db = JSON.parse(
  readFileSync(path.join(ROOT, "fixtures/render-db/2.1.11.json"), "utf8"),
) as RenderDb;
const fixtureRaw = readFileSync(
  path.join(ROOT, "fixtures/demos/deconstruction-planners.bp.txt"),
  "utf8",
).trim();
const fixtureDoc = decode(fixtureRaw);

describe("planDeconstructionPlannerDrawList", () => {
  it("plans blacklist entities and hides the empty tiles section", () => {
    const planner = selectDeconstructionPlanner(fixtureDoc, [0]);
    const list = planDeconstructionPlannerDrawList(planner, db);

    const texts = list.commands.filter((cmd) => cmd.kind === "text");
    expect(texts.map((cmd) => cmd.text)).toEqual(["Entities / Blacklist"]);

    const icons = list.commands.filter((cmd) => cmd.kind === "icon");
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon.silhouette).toBeUndefined();
      expect(icon.backing).toBeUndefined();
      expect(icon.backingFrame).toBeUndefined();
      expect(icon.layer).toBe(RENDER_LAYERS.icons);
      expect(icon.size).toBe(1);
      // Icons snap to tile centers (*.5).
      expect(icon.x).toBe(Math.floor(icon.x) + 0.5);
      expect(icon.y).toBe(Math.floor(icon.y) + 0.5);
    }
    expect(icons[0]?.frame).toBe(db.icons["entity/storage-tank"]);
    expect(icons[0]?.x).toBe(1.5);
    expect(icons[0]?.y).toBe(2.5); // header row at y=1, icons start at y=2
    expect(icons[1]?.frame).toBe(db.icons["entity/burner-inserter"]);
    expect(icons[1]?.x).toBe(2.5);
    expect(icons[1]?.y).toBe(2.5);
  });

  it("defaults entity mode to whitelist when omitted", () => {
    const planner = selectDeconstructionPlanner(fixtureDoc, [1]);
    const list = planDeconstructionPlannerDrawList(planner, db);
    const texts = list.commands.filter((cmd) => cmd.kind === "text");
    expect(texts.map((cmd) => cmd.text)).toEqual(["Entities / Whitelist"]);
  });

  it("places tile selection mode after whitelist/blacklist", () => {
    const planner = selectDeconstructionPlanner(fixtureDoc, [3]);
    const list = planDeconstructionPlannerDrawList(planner, db);
    const texts = list.commands.filter((cmd) => cmd.kind === "text");
    expect(texts.some((cmd) => cmd.text === "Tiles / Whitelist / Normal")).toBe(true);
    const icons = list.commands.filter((cmd) => cmd.kind === "icon");
    expect(icons.length).toBeGreaterThanOrEqual(5);
    for (const icon of icons) {
      expect(icon.x).toBe(Math.floor(icon.x) + 0.5);
      expect(icon.y).toBe(Math.floor(icon.y) + 0.5);
    }
    // Tile filter slots use map swatches (`tile/…`), not placing-item icons.
    const tileFrames = new Set(
      ["stone-path", "hazard-concrete-left", "artificial-jellynut-soil", "frozen-concrete"]
        .map((name) => db.icons[`tile/${name}`])
        .filter((id): id is number => id != null),
    );
    expect(tileFrames.size).toBe(4);
    const tileIcons = icons.filter((icon) => tileFrames.has(icon.frame));
    expect(tileIcons.length).toBe(4);
  });

  it("renders trees/rocks only as a tree icon + label without filter grids", () => {
    const planner = selectDeconstructionPlanner(fixtureDoc, [2]);
    const list = planDeconstructionPlannerDrawList(planner, db);
    const texts = list.commands.filter((cmd) => cmd.kind === "text");
    expect(texts.map((cmd) => cmd.text)).toEqual(["Trees/rocks only"]);

    const icons = list.commands.filter((cmd) => cmd.kind === "icon");
    expect(icons).toHaveLength(1);
    expect(icons[0]?.x).toBe(1.5);
    expect(icons[0]?.y).toBe(1.5);
    expect(db.icons[TREES_AND_ROCKS_ICON_KEY]).toBeDefined();
    expect(icons[0]?.frame).toBe(db.icons[TREES_AND_ROCKS_ICON_KEY]);
  });

  it("omits empty entity and tile sections", () => {
    const list = planDeconstructionPlannerDrawList({ settings: {} }, db);
    expect(list.commands).toEqual([]);
    expect(list.bounds).toEqual({ minX: 0, minY: 0, maxX: 14, maxY: 2 });
  });
});
