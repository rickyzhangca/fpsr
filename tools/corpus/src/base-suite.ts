import type { BlueprintBook, BlueprintDocument, RenderDb } from "@rickyzhangca/fpsr";
import {
  BASE_ENTITY_NAMES,
  BASE_GAME_BOOK_SPEC,
  BASE_GAME_VERSION,
  BASE_TILE_NAMES,
} from "./base-game-book-spec.js";
import {
  combatItemsGroup,
  internalLegacyGroup,
  logisticsGroup,
  productionGroup,
  spaceGroup,
  type BaseSuiteBuild,
  type BaseSuiteManifest,
  type BaseSuitePage,
  type BaseSuiteCell,
  type GroupDraft,
  type GroupBookEntry,
} from "./suite-cases/index.js";
import { itemIcons, makeBook } from "./suite-layout.js";

export type {
  BaseSuiteBuild,
  BaseSuiteCaseKind,
  BaseSuiteCell,
  BaseSuiteManifest,
  BaseSuitePage,
  BeltNeighborState,
} from "./suite-cases/index.js";

function specIcons(icons: readonly string[]) {
  return itemIcons(...icons);
}

function groupBookEntries(entries: GroupBookEntry[]): BlueprintBook["blueprints"] {
  return entries.map((entry, index) => {
    if (entry.kind === "page") {
      return { index, blueprint: entry.page.blueprint };
    }
    return {
      index,
      blueprint_book: makeBook(
        entry.label,
        entry.icons,
        entry.pages.map((page, pageIndex) => ({ index: pageIndex, blueprint: page.blueprint })),
      ),
    };
  });
}

function appendGroupPages(
  group: GroupDraft,
  pathPrefix: number[],
  pages: BaseSuitePage[],
  cells: BaseSuiteCell[],
): void {
  for (const [entryIndex, groupEntry] of group.entries.entries()) {
    if (groupEntry.kind === "page") {
      const path = [...pathPrefix, entryIndex];
      for (const cell of groupEntry.page.cells) cell.pagePath = path;
      pages.push({
        id: groupEntry.page.id,
        label: groupEntry.page.label,
        sectionId: groupEntry.page.sectionId,
        groupId: groupEntry.page.groupId,
        path,
        cellIds: groupEntry.page.cells.map((cell) => cell.id),
        entityCount: groupEntry.page.blueprint.entities?.length ?? 0,
        tileCount: groupEntry.page.blueprint.tiles?.length ?? 0,
      });
      cells.push(...groupEntry.page.cells);
      continue;
    }

    for (const [pageIndex, page] of groupEntry.pages.entries()) {
      const path = [...pathPrefix, entryIndex, pageIndex];
      for (const cell of page.cells) cell.pagePath = path;
      pages.push({
        id: page.id,
        label: page.label,
        sectionId: page.sectionId,
        groupId: page.groupId,
        path,
        cellIds: page.cells.map((cell) => cell.id),
        entityCount: page.blueprint.entities?.length ?? 0,
        tileCount: page.blueprint.tiles?.length ?? 0,
      });
      cells.push(...page.cells);
    }
  }
}

function assertRenderMetadataCoverage(renderDb: RenderDb): void {
  if (renderDb.gameVersion !== BASE_GAME_VERSION || renderDb.mods.join(",") !== "base") {
    throw new Error(
      `Base suite requires the exact ${BASE_GAME_VERSION} [base] render DB; got ` +
        `${renderDb.gameVersion} [${renderDb.mods.join(", ")}]`,
    );
  }
  const missingEntities = BASE_ENTITY_NAMES.filter((name) => renderDb.entities[name] == null);
  const missingTiles = BASE_TILE_NAMES.filter((name) => renderDb.tiles[name] == null);
  const expectedEntities = new Set(BASE_ENTITY_NAMES);
  const expectedTiles = new Set(BASE_TILE_NAMES);
  const duplicateEntities = BASE_ENTITY_NAMES.filter(
    (name, index) => BASE_ENTITY_NAMES.indexOf(name) !== index,
  );
  const duplicateTiles = BASE_TILE_NAMES.filter(
    (name, index) => BASE_TILE_NAMES.indexOf(name) !== index,
  );
  const unexpectedEntities = Object.keys(renderDb.entities).filter(
    (name) => !expectedEntities.has(name),
  );
  const unexpectedTiles = Object.keys(renderDb.tiles).filter((name) => !expectedTiles.has(name));
  if (
    missingEntities.length > 0 ||
    missingTiles.length > 0 ||
    duplicateEntities.length > 0 ||
    duplicateTiles.length > 0 ||
    unexpectedEntities.length > 0 ||
    unexpectedTiles.length > 0
  ) {
    throw new Error(
      [
        missingEntities.length > 0 ? `entities: ${missingEntities.join(", ")}` : "",
        missingTiles.length > 0 ? `tiles: ${missingTiles.join(", ")}` : "",
        duplicateEntities.length > 0
          ? `duplicate entities: ${[...new Set(duplicateEntities)].join(", ")}`
          : "",
        duplicateTiles.length > 0
          ? `duplicate tiles: ${[...new Set(duplicateTiles)].join(", ")}`
          : "",
        unexpectedEntities.length > 0
          ? `unexpected entities: ${unexpectedEntities.join(", ")}`
          : "",
        unexpectedTiles.length > 0 ? `unexpected tiles: ${unexpectedTiles.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

export function buildBaseSuite(renderDb: RenderDb): BaseSuiteBuild {
  assertRenderMetadataCoverage(renderDb);

  const groupBuilders: Record<string, (db: RenderDb) => GroupDraft> = {
    logistics: logisticsGroup,
    production: productionGroup,
    space: spaceGroup,
    "combat-items": combatItemsGroup,
    "internal-legacy": internalLegacyGroup,
  };
  const rootGroups = BASE_GAME_BOOK_SPEC.children.map((entry) => {
    if (entry.kind !== "book") throw new Error(`Base root entry ${entry.id} must be a book`);
    const build = groupBuilders[entry.id];
    if (!build) throw new Error(`Missing Base group builder for ${entry.id}`);
    return build(renderDb);
  });

  const pages: BaseSuitePage[] = [];
  const cells: BaseSuiteCell[] = [];
  const rootBlueprintEntries: BlueprintBook["blueprints"] = [];

  rootGroups.forEach((group, rootIndex) => {
    appendGroupPages(group, [rootIndex], pages, cells);
    rootBlueprintEntries.push({
      index: rootIndex,
      blueprint_book: makeBook(group.label, group.icons, groupBookEntries(group.entries)),
    });
  });

  const document: BlueprintDocument = {
    blueprint_book: makeBook(
      BASE_GAME_BOOK_SPEC.label,
      specIcons(BASE_GAME_BOOK_SPEC.icons),
      rootBlueprintEntries,
    ),
  };

  const manifest: BaseSuiteManifest = {
    schema: 1,
    suiteId: "base-game-2.1.11",
    gameVersion: BASE_GAME_VERSION,
    requiredMods: ["base"],
    canaryPageIds: [
      "entity-poses/logistics/inserters",
      "entity-poses/logistics/transport/car",
      "entity-poses/logistics/terrain",
    ],
    inventory: {
      source: "base-game-book-spec",
      specId: BASE_GAME_BOOK_SPEC.id,
      entityCount: BASE_ENTITY_NAMES.length,
      tileCount: BASE_TILE_NAMES.length,
    },
    renderMetadata: {
      role: "exact-base-graphics-and-pose-metadata",
      gameVersion: renderDb.gameVersion,
      mods: [...renderDb.mods],
      baseOnly: true,
    },
    referenceOracle: {
      status: "local-capture-required",
      reason:
        "Exact Base metadata is committed, but real-game PNG references are generated locally and intentionally not committed.",
    },
    contract: {
      covered: [
        "Every curated Base 2.1.11 entity prototype, including hidden/internal and legacy prototypes",
        "All declared 16-way, 8-way, cardinal, and 64-step orientation poses",
        "A 7×7 patch for every curated Base tile",
        "Cases packed from pose-specific non-shadow sprite/tile bounds with one empty tile between neighboring cases",
      ],
      deferred: [
        "Powered, animated, crafting, fluid-level, gate-open, turret-aim, and other runtime states",
        "Arbitrary circuit networks, wire topologies, inventories, recipes, modules, filters, schedules, and train consists",
        "Combinatorial neighbor states outside the explicit pipe, heat-pipe, wall, and belt matrices",
        "Pixel correctness on machines where the exact Factorio 2.1.11 Base reference set has not been captured",
      ],
    },
    coverage: {
      entityPrototypeCount: BASE_ENTITY_NAMES.length,
      entityPoseCaseCount: cells.filter((cell) => cell.caseKind === "entity-pose").length,
      adjacencyMaskCaseCount: cells.filter((cell) => cell.caseKind === "adjacency-mask").length,
      beltNeighborhoodCaseCount: cells.filter((cell) => cell.caseKind === "belt-neighborhood")
        .length,
      tileCaseCount: cells.filter((cell) => cell.caseKind === "tile-patch").length,
      pageCount: pages.length,
    },
    pages,
    cells,
  };

  return { document, manifest };
}
