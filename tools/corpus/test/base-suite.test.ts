import {
  encode,
  listBlueprints,
  planDrawList,
  selectBlueprint,
  type BlueprintBook,
  type Icon,
  type RenderDb,
} from "fpsr";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { BASE_ENTITY_NAMES, BASE_TILE_NAMES } from "../src/base-game-catalog.js";
import { buildBaseSuite } from "../src/base-suite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const renderDb = JSON.parse(
  await readFile(path.join(REPO_ROOT, "fixtures/render-db/2.1.11-base.json"), "utf8"),
) as RenderDb;
const suite = buildBaseSuite(renderDb);

function collectBookIcons(book: BlueprintBook, result: Icon[][]): void {
  result.push(book.icons ?? []);
  for (const entry of book.blueprints ?? []) {
    if (entry.blueprint) result.push(entry.blueprint.icons ?? []);
    if (entry.blueprint_book) collectBookIcons(entry.blueprint_book, result);
  }
}

function focusEntity(caseId: string) {
  const cell = suite.manifest.cells.find((entry) => entry.id === caseId);
  if (!cell) throw new Error(`Missing case ${caseId}`);
  const blueprint = selectBlueprint(suite.document, cell.pagePath);
  const entity = blueprint.entities?.find(
    (entry) => entry.entity_number === cell.focusEntityNumbers[0],
  );
  if (!entity) throw new Error(`Missing focus entity for ${caseId}`);
  return entity;
}

function coordinateFraction(value: number): number {
  return ((value % 1) + 1) % 1;
}

describe("Base game visual suite", () => {
  it("owns a unique curated Base inventory independent of render-db inventory", () => {
    expect(BASE_ENTITY_NAMES).toHaveLength(109);
    expect(new Set(BASE_ENTITY_NAMES).size).toBe(BASE_ENTITY_NAMES.length);
    expect(BASE_TILE_NAMES).toHaveLength(8);
    expect(suite.manifest.inventory.source).toBe("curated-base-2.1.11-catalog");
    expect(suite.manifest.inventory.entityCount).toBe(109);
    expect([...BASE_ENTITY_NAMES].sort()).toEqual(Object.keys(renderDb.entities).sort());
    expect([...BASE_TILE_NAMES].sort()).toEqual(Object.keys(renderDb.tiles).sort());

    const excluded = ["turbo-transport-belt", "rail-ramp", "recycler", "foundry", "quality-module"];
    for (const name of excluded) expect(BASE_ENTITY_NAMES).not.toContain(name);
  });

  it("builds a deterministic nested book with addressable pages and cells", () => {
    const refs = listBlueprints(suite.document);
    expect(refs).toHaveLength(suite.manifest.pages.length);
    expect(refs.length).toBeGreaterThan(100);
    expect(suite.document.blueprint_book?.blueprints).toHaveLength(4);

    const caseIds = suite.manifest.cells.map((cell) => cell.id);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    for (const page of suite.manifest.pages) {
      const blueprint = selectBlueprint(suite.document, page.path);
      expect(blueprint.label).toBe(page.label);
      expect(page.cellIds.length).toBeGreaterThan(0);
      expect(page.cellIds.length).toBeLessThanOrEqual(64);
    }
    for (const cell of suite.manifest.cells) {
      expect(cell.pagePath.length).toBeGreaterThanOrEqual(3);
      expect(suite.manifest.pages.some((page) => page.id === cell.pageId)).toBe(true);
    }
    for (const cell of suite.manifest.cells.filter((entry) => entry.caseKind !== "tile-patch")) {
      expect(cell.focusEntityNumbers.length).toBeGreaterThan(0);
    }
  });

  it("keeps the committed book and manifest in sync with the generator", async () => {
    const outputDir = path.join(REPO_ROOT, "fixtures/visual-tests/base-game");
    const [book, manifest] = await Promise.all([
      readFile(path.join(outputDir, "book.bp.txt"), "utf8"),
      readFile(path.join(outputDir, "manifest.json"), "utf8"),
    ]);
    expect(book.trim()).toBe(encode(suite.document));
    expect(JSON.parse(manifest)).toEqual(suite.manifest);
  });

  it("packs one-tile entities with a non-overlapping visual gap", () => {
    const blueprint = selectBlueprint(suite.document, [0, 0, 0]);
    const firstRow = blueprint.entities?.slice(0, 4) ?? [];
    expect(firstRow).toHaveLength(4);
    for (const entity of firstRow) {
      expect(coordinateFraction(entity.position.x)).toBe(0.5);
      expect(coordinateFraction(entity.position.y)).toBe(0.5);
    }

    const firstPage = suite.manifest.pages.find((page) => page.path.join(".") === "0.0.0");
    const firstRowCells = suite.manifest.cells
      .filter((cell) => cell.pageId === firstPage?.id)
      .slice(0, 4);
    expect(firstRowCells).toHaveLength(4);
    for (let index = 1; index < firstRowCells.length; index++) {
      expect(firstRowCells[index - 1]!.cropTiles.right).toBeLessThanOrEqual(
        firstRowCells[index]!.cropTiles.left,
      );
    }
  });

  it("snaps generated entities to Factorio placement parity", () => {
    for (const caseId of [
      "pose/inserter/d00",
      "pose/assembling-machine-1/d00",
      "connectivity/pipe/mask-00",
      "logistics/rail-signals/pose/rail-signal/d00",
      "logistics/car/pose/car/o00",
    ]) {
      const entity = focusEntity(caseId);
      expect(coordinateFraction(entity.position.x)).toBe(0.5);
      expect(coordinateFraction(entity.position.y)).toBe(0.5);
    }

    for (const caseId of [
      "pose/stone-furnace/d00",
      "logistics/rails/pose/straight-rail/d00",
      "logistics/locomotive/pose/locomotive/o00",
    ]) {
      const entity = focusEntity(caseId);
      expect(coordinateFraction(entity.position.x)).toBe(0);
      expect(coordinateFraction(entity.position.y)).toBe(0);
    }

    const northSplitter = focusEntity("pose/splitter/d00");
    expect(coordinateFraction(northSplitter.position.x)).toBe(0);
    expect(coordinateFraction(northSplitter.position.y)).toBe(0.5);
    const eastSplitter = focusEntity("pose/splitter/d04");
    expect(coordinateFraction(eastSplitter.position.x)).toBe(0.5);
    expect(coordinateFraction(eastSplitter.position.y)).toBe(0);

    const tilePage = suite.manifest.pages.find(
      (page) => page.id === "entity-poses/logistics/tiles",
    );
    if (!tilePage) throw new Error("Missing logistics stone-path tile page");
    const tileBlueprint = selectBlueprint(suite.document, tilePage.path);
    for (const tile of tileBlueprint.tiles ?? []) {
      expect(Number.isInteger(tile.position.x)).toBe(true);
      expect(Number.isInteger(tile.position.y)).toBe(true);
    }
  });

  it("packs tall entities by non-shadow sprite bounds", () => {
    const page = suite.manifest.pages.find((entry) => entry.path.join(".") === "0.3.0");
    if (!page) throw new Error("Missing first power page");
    const cells = suite.manifest.cells.filter((cell) => cell.pageId === page.id);
    expect(cells).toHaveLength(12);

    const rows = [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8, 12)];
    for (const row of rows) {
      for (let index = 1; index < row.length; index++) {
        expect(row[index - 1]!.cropTiles.right).toBeLessThanOrEqual(row[index]!.cropTiles.left);
      }
    }
    for (let index = 1; index < rows.length; index++) {
      const previousBottom = Math.max(...rows[index - 1]!.map((cell) => cell.cropTiles.bottom));
      const nextTop = Math.min(...rows[index]!.map((cell) => cell.cropTiles.top));
      expect(previousBottom).toBeLessThanOrEqual(nextTop);
    }

    const smallPole = cells[0]!;
    expect(smallPole.cropTiles.bottom - smallPole.cropTiles.top).toBeGreaterThan(3);
    const blueprint = selectBlueprint(suite.document, page.path);
    const drawList = planDrawList(blueprint, renderDb);
    const shadowExtendsOutsideCrop = drawList.commands.some(
      (command) =>
        command.kind === "sprite" &&
        command.shadow === true &&
        command.entity === smallPole.focusEntityNumbers[0] &&
        (command.x < smallPole.cropTiles.left ||
          command.y < smallPole.cropTiles.top ||
          command.x + command.w > smallPole.cropTiles.right ||
          command.y + command.h > smallPole.cropTiles.bottom),
    );
    expect(shadowExtendsOutsideCrop).toBe(true);
  });

  it("gives every book and leaf blueprint valid descriptive icons", () => {
    const iconSets: Icon[][] = [];
    collectBookIcons(suite.document.blueprint_book!, iconSets);
    expect(iconSets.length).toBeGreaterThan(suite.manifest.pages.length);
    for (const icons of iconSets) {
      expect(icons.length).toBeGreaterThan(0);
      expect(icons.length).toBeLessThanOrEqual(4);
      expect(icons.map((icon) => icon.index)).toEqual(
        Array.from({ length: icons.length }, (_, index) => index + 1),
      );
      for (const icon of icons) {
        expect(renderDb.icons[`item/${icon.signal.name}`]).toBeDefined();
      }
    }
  });

  it("covers declared direction, orientation, connectivity, and tile matrices", () => {
    const poseCells = suite.manifest.cells.filter((cell) => cell.caseKind === "entity-pose");
    expect(poseCells.filter((cell) => cell.entityName === "rail-signal")).toHaveLength(16);
    expect(poseCells.filter((cell) => cell.entityName === "straight-rail")).toHaveLength(8);
    expect(poseCells.filter((cell) => cell.entityName === "locomotive")).toHaveLength(64);
    expect(poseCells.filter((cell) => cell.entityName === "underground-belt")).toHaveLength(8);

    for (const name of ["pipe", "heat-pipe", "stone-wall"]) {
      const masks = suite.manifest.cells
        .filter((cell) => cell.caseKind === "adjacency-mask" && cell.entityName === name)
        .map((cell) => cell.adjacency?.mask);
      expect(masks).toEqual(Array.from({ length: 16 }, (_, index) => index));
    }

    expect(suite.manifest.coverage.adjacencyMaskCaseCount).toBe(3 * 16);
    expect(suite.manifest.coverage.beltNeighborhoodCaseCount).toBe(3 * 4 * 3 ** 4);
    expect(suite.manifest.coverage.tileCaseCount).toBe(BASE_TILE_NAMES.length);
    expect(
      suite.manifest.cells
        .filter((cell) => cell.caseKind === "tile-patch")
        .map((cell) => cell.tileName),
    ).toEqual([...BASE_TILE_NAMES]);
  });

  it("plans every generated page without renderer errors", () => {
    for (const page of suite.manifest.pages) {
      expect(() =>
        planDrawList(selectBlueprint(suite.document, page.path), renderDb),
      ).not.toThrow();
    }
  });

  it("is pinned to exact Base-only metadata and requires local game references", () => {
    expect(suite.manifest.renderMetadata.baseOnly).toBe(true);
    expect(suite.manifest.renderMetadata.role).toBe("exact-base-graphics-and-pose-metadata");
    expect(suite.manifest.renderMetadata.gameVersion).toBe("2.1.11");
    expect(suite.manifest.renderMetadata.mods).toEqual(["base"]);
    expect(suite.manifest.referenceOracle.status).toBe("local-capture-required");
  });
});
