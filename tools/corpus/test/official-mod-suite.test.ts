import { encode, listBlueprints, selectBlueprint, type RenderDb } from "@rickyzhangca/fpsr";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { BASE_ENTITY_NAMES, BASE_TILE_NAMES } from "../src/base-game-book-spec.js";
import { ELEVATED_RAILS_BOOK_SPEC } from "../src/elevated-rails-book-spec.js";
import { entityNamesInBook, pagesInBook, tileNamesInBook } from "../src/mod-book-spec.js";
import { OFFICIAL_MOD_BOOK_SPECS, OFFICIAL_MOD_PROFILE } from "../src/official-mod-book-specs.js";
import { buildOfficialModSuite } from "../src/official-mod-suite.js";
import { QUALITY_BOOK_SPEC } from "../src/quality-book-spec.js";
import { RECYCLER_BOOK_SPEC } from "../src/recycler-book-spec.js";
import { SPACE_AGE_BOOK_SPEC } from "../src/space-age-book-spec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const fullRenderDb = JSON.parse(
  await readFile(path.join(REPO_ROOT, "fixtures/render-db/2.1.11.json"), "utf8"),
) as RenderDb;
const baseRenderDb = JSON.parse(
  await readFile(path.join(REPO_ROOT, "fixtures/render-db/2.1.11-base.json"), "utf8"),
) as RenderDb;
const suite = buildOfficialModSuite(fullRenderDb);

describe("official-mod visual suite foundation", () => {
  it("keeps one independently owned inventory spec per official mod", () => {
    expect(OFFICIAL_MOD_BOOK_SPECS.map((spec) => spec.mod)).toEqual([
      "space-age",
      "quality",
      "elevated-rails",
      "recycler",
    ]);
    expect(entityNamesInBook(ELEVATED_RAILS_BOOK_SPEC)).toHaveLength(6);
    expect(entityNamesInBook(QUALITY_BOOK_SPEC)).toHaveLength(0);
    expect(entityNamesInBook(RECYCLER_BOOK_SPEC)).toEqual(["recycler"]);
    expect(entityNamesInBook(SPACE_AGE_BOOK_SPEC)).toHaveLength(27);
    expect(tileNamesInBook(SPACE_AGE_BOOK_SPEC)).toHaveLength(15);
    expect(pagesInBook(QUALITY_BOOK_SPEC)).toHaveLength(0);
  });

  it("owns exactly the all-official inventory beyond Base", () => {
    const officialEntities = OFFICIAL_MOD_BOOK_SPECS.flatMap(entityNamesInBook);
    const officialTiles = OFFICIAL_MOD_BOOK_SPECS.flatMap(tileNamesInBook);
    const expectedEntities = Object.keys(fullRenderDb.entities).filter(
      (name) => !BASE_ENTITY_NAMES.includes(name),
    );
    const expectedTiles = Object.keys(fullRenderDb.tiles).filter(
      (name) => !BASE_TILE_NAMES.includes(name),
    );

    expect(new Set(officialEntities).size).toBe(officialEntities.length);
    expect(new Set(officialTiles).size).toBe(officialTiles.length);
    expect([...officialEntities].sort()).toEqual(expectedEntities.sort());
    expect([...officialTiles].sort()).toEqual(expectedTiles.sort());
  });

  it("composes non-empty mod specs into addressable multi-pose placement pages", () => {
    expect(suite.manifest.requiredMods).toEqual([...OFFICIAL_MOD_PROFILE]);
    expect(suite.manifest.books).toEqual([
      { specId: "space-age-2.1.11", mod: "space-age", file: "space-age.bp.txt" },
      { specId: "quality-2.1.11", mod: "quality", file: "quality.bp.txt" },
      { specId: "elevated-rails-2.1.11", mod: "elevated-rails", file: "elevated-rails.bp.txt" },
      { specId: "recycler-2.1.11", mod: "recycler", file: "recycler.bp.txt" },
    ]);
    expect(suite.manifest.coverage).toEqual({
      entityPrototypeCount: 34,
      entityPlacementCaseCount: 140,
      tilePrototypeCount: 15,
      tileCaseCount: 15,
      pageCount: 6,
    });
    expect(suite.books).toHaveLength(4);
    expect(listBlueprints(suite.books[0]!.document)).toHaveLength(4);
    expect(listBlueprints(suite.books[1]!.document)).toHaveLength(0);
    expect(listBlueprints(suite.books[2]!.document)).toHaveLength(1);
    expect(listBlueprints(suite.books[3]!.document)).toHaveLength(1);
    expect(suite.books.flatMap((book) => listBlueprints(book.document))).toHaveLength(6);

    const entityCells = suite.manifest.cells.filter((cell) => cell.caseKind === "entity-pose");
    const tileCells = suite.manifest.cells.filter((cell) => cell.caseKind === "tile-patch");
    expect(entityCells.some((cell) => cell.pose?.axis === "direction")).toBe(true);
    expect(entityCells.filter((cell) => cell.entityName === "elevated-straight-rail")).toHaveLength(
      8,
    );
    expect(entityCells.filter((cell) => cell.entityName === "recycler")).toHaveLength(4);
    expect(entityCells.filter((cell) => cell.entityName === "turbo-underground-belt")).toHaveLength(
      8,
    );
    expect(entityCells.filter((cell) => cell.entityName === "stack-inserter")).toHaveLength(4);
    expect(new Set(entityCells.map((cell) => cell.entityName)).size).toBe(34);
    expect(new Set(tileCells.map((cell) => cell.tileName)).size).toBe(15);

    for (const page of suite.manifest.pages) {
      const book = suite.books.find((entry) => entry.specId === page.bookSpecId);
      expect(book).toBeDefined();
      expect(selectBlueprint(book!.document, page.path).label).toBe(page.label);
    }
    for (const pageId of suite.manifest.canaryPageIds) {
      expect(suite.manifest.pages.some((page) => page.id === pageId)).toBe(true);
    }

    expect(suite.manifest.inventory.specs.find((spec) => spec.mod === "quality")).toEqual({
      mod: "quality",
      specId: "quality-2.1.11",
      entityCount: 0,
      tileCount: 0,
      emitted: false,
    });
  });

  it("keeps each entity's poses on dedicated rows instead of flat 4-wide mixing", () => {
    const isolatedSinglePoseRowLengths: number[] = [];
    for (const pageId of [
      "official-mods/space-age/production",
      "official-mods/space-age/space",
      "official-mods/space-age/combat",
      "official-mods/space-age/logistics",
    ]) {
      const page = suite.manifest.pages.find((entry) => entry.id === pageId);
      expect(page).toBeDefined();
      const cells = page!.cellIds
        .map((id) => suite.manifest.cells.find((cell) => cell.id === id)!)
        .filter((cell) => cell.caseKind === "entity-pose");

      const rows = new Map<number, typeof cells>();
      for (const cell of cells) {
        const rowKey = cell.cropTiles.top;
        const row = rows.get(rowKey) ?? [];
        row.push(cell);
        rows.set(rowKey, row);
      }

      for (const row of rows.values()) {
        expect(row.length).toBeGreaterThan(0);
        expect(row.length).toBeLessThanOrEqual(4);
        expect(new Set(row.map((cell) => cell.entityName)).size).toBe(1);
      }

      // Production/space include single-pose entities; they must not share a row with neighbors.
      if (pageId.endsWith("/production") || pageId.endsWith("/space")) {
        const singlePoseNames = [
          ...new Set(
            cells
              .filter(
                (cell) =>
                  cells.filter((other) => other.entityName === cell.entityName).length === 1,
              )
              .map((cell) => cell.entityName!),
          ),
        ];
        isolatedSinglePoseRowLengths.push(
          ...singlePoseNames.map((name) => {
            const cell = cells.find((entry) => entry.entityName === name)!;
            return rows.get(cell.cropTiles.top)!.length;
          }),
        );
      }
    }
    expect(isolatedSinglePoseRowLengths.length).toBeGreaterThan(0);
    expect(isolatedSinglePoseRowLengths.every((length) => length === 1)).toBe(true);
  });

  it("requires the exact all-official render metadata profile", () => {
    expect(() => buildOfficialModSuite(baseRenderDb)).toThrow(/requires exact 2\.1\.11/i);
  });

  it("keeps committed official-mod outputs in sync with the generator", async () => {
    const outputDir = path.join(REPO_ROOT, "fixtures/visual-tests/official-mods");
    const [manifestSource] = await Promise.all([
      readFile(path.join(outputDir, "manifest.json"), "utf8"),
      ...suite.books.map((book) =>
        readFile(path.join(outputDir, book.file), "utf8").then((source) => {
          expect(source.trim()).toBe(encode(book.document));
        }),
      ),
    ]);
    expect(JSON.parse(manifestSource)).toEqual(suite.manifest);
  });
});
