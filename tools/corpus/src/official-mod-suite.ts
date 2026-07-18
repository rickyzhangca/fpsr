import {
  planDrawList,
  type Blueprint,
  type BlueprintBook,
  type BlueprintDocument,
  type BlueprintEntity,
  type DrawListBounds,
  type RenderDb,
  type Tile,
} from "fpsr";
import { BASE_ENTITY_NAMES, BASE_GAME_VERSION, BASE_TILE_NAMES } from "./base-game-book-spec.js";
import { poseCellId, posesForEntity, type EntityPose } from "./entity-poses.js";
import {
  entityNamesInBook,
  pagesInBook,
  tileNamesInBook,
  validateModBookSpec,
  type BookSpec,
  type FactorioModBookSpec,
  type PageSpec,
} from "./mod-book-spec.js";
import { OFFICIAL_MOD_BOOK_SPECS, OFFICIAL_MOD_PROFILE } from "./official-mod-book-specs.js";
import {
  BLUEPRINT_VERSION,
  CASES_PER_ROW,
  CASE_GAP_TILES,
  CROP_MARGIN_TILES,
  chunk,
  cleanCoordinate,
  itemIcons,
  makeBook as makeBlueprintBook,
  packedTranslation,
  type SuiteCaseBounds,
  type SuiteLattice,
} from "./suite-layout.js";

const TILE_PATCH_SIZE = 7;

export type OfficialModSuiteCaseKind = "entity-pose" | "tile-patch";

export interface OfficialModSuiteCell {
  id: string;
  caseKind: OfficialModSuiteCaseKind;
  pageId: string;
  pagePath: number[];
  cropTiles: { left: number; top: number; right: number; bottom: number };
  focusEntityNumbers: number[];
  entityName?: string;
  tileName?: string;
  pose?: EntityPose;
  tilePatch?: { width: number; height: number };
}

export interface OfficialModSuitePage {
  id: string;
  label: string;
  sectionId: "official-mods";
  groupId: string;
  bookSpecId: string;
  path: number[];
  cellIds: string[];
  entityCount: number;
  tileCount: number;
}

export interface OfficialModSuiteBook {
  specId: string;
  mod: string;
  file: string;
  document: BlueprintDocument;
}

export interface OfficialModSuiteManifest {
  schema: 1;
  suiteId: "official-mods-2.1.11";
  gameVersion: typeof BASE_GAME_VERSION;
  requiredMods: [...typeof OFFICIAL_MOD_PROFILE];
  canaryPageIds: string[];
  books: Array<{
    specId: string;
    mod: string;
    file: string;
  }>;
  inventory: {
    source: "per-mod-book-specs";
    specs: Array<{
      mod: string;
      specId: string;
      entityCount: number;
      tileCount: number;
      emitted: boolean;
    }>;
  };
  renderMetadata: {
    role: "exact-all-official-graphics-metadata";
    gameVersion: string;
    mods: string[];
  };
  rendererDiagnostics: Array<{ entityName: string; message: string }>;
  contract: {
    covered: string[];
    deferred: string[];
  };
  coverage: {
    entityPrototypeCount: number;
    entityPlacementCaseCount: number;
    tilePrototypeCount: number;
    tileCaseCount: number;
    pageCount: number;
  };
  pages: OfficialModSuitePage[];
  cells: OfficialModSuiteCell[];
}

export interface OfficialModSuiteBuild {
  books: OfficialModSuiteBook[];
  manifest: OfficialModSuiteManifest;
}

interface EntityCase {
  kind: "entity";
  name: string;
  pose: EntityPose;
  bounds: SuiteCaseBounds;
  lattice: SuiteLattice;
}

interface TileCase {
  kind: "tile";
  name: string;
  bounds: SuiteCaseBounds;
  lattice: { x: 0; y: 0 };
}

type PlacementCase = EntityCase | TileCase;

interface PageDraft {
  spec: PageSpec;
  mod: string;
  blueprint: Blueprint;
  cells: OfficialModSuiteCell[];
}

function makeBook(
  label: string,
  icons: readonly string[],
  entries: BlueprintBook["blueprints"],
): BlueprintBook {
  return makeBlueprintBook(label, itemIcons(...icons), entries);
}

function drawListToSuiteBounds(bounds: DrawListBounds): SuiteCaseBounds {
  return {
    left: bounds.minX,
    top: bounds.minY,
    right: bounds.maxX,
    bottom: bounds.maxY,
  };
}

function selectionBounds(name: string, renderDb: RenderDb): SuiteCaseBounds {
  const def = renderDb.entities[name];
  if (!def) throw new Error(`Missing render metadata for ${name}`);
  return {
    left: def.selectionBox[0][0],
    top: def.selectionBox[0][1],
    right: def.selectionBox[1][0],
    bottom: def.selectionBox[1][1],
  };
}

function usableBounds(bounds: DrawListBounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX &&
    bounds.maxY > bounds.minY
  );
}

function entityBlueprintFields(name: string, pose: EntityPose): BlueprintEntity {
  return {
    entity_number: 1,
    name,
    position: { x: 0, y: 0 },
    ...(pose.axis === "orientation" ? { orientation: pose.orientation } : {}),
    ...(pose.direction != null ? { direction: pose.direction } : {}),
    ...(pose.type ? { type: pose.type } : {}),
  };
}

function entityBounds(
  name: string,
  pose: EntityPose,
  renderDb: RenderDb,
  diagnostics: OfficialModSuiteManifest["rendererDiagnostics"],
): SuiteCaseBounds {
  try {
    const drawList = planDrawList(
      {
        item: "blueprint",
        version: BLUEPRINT_VERSION,
        entities: [entityBlueprintFields(name, pose)],
      },
      renderDb,
    );
    if (drawList.commands.length > 0 && usableBounds(drawList.bounds)) {
      return drawListToSuiteBounds(drawList.bounds);
    }
    diagnostics.push({ entityName: name, message: "planner emitted no usable visual bounds" });
  } catch (error) {
    diagnostics.push({
      entityName: name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return selectionBounds(name, renderDb);
}

function entityLattice(name: string, pose: EntityPose, renderDb: RenderDb): EntityCase["lattice"] {
  const def = renderDb.entities[name];
  if (!def) throw new Error(`Missing render metadata for ${name}`);
  if (def.kind === "rail" || def.kind === "train" || def.protoType === "rail-support") {
    return { x: 0, y: 0 };
  }

  const width = Math.max(1, Math.round(def.selectionBox[1][0] - def.selectionBox[0][0]));
  const height = Math.max(1, Math.round(def.selectionBox[1][1] - def.selectionBox[0][1]));
  const quarterTurns = Math.round((pose.direction ?? 0) / 4) % 4;
  const placedWidth = quarterTurns % 2 === 0 ? width : height;
  const placedHeight = quarterTurns % 2 === 0 ? height : width;
  return {
    x: placedWidth % 2 === 0 ? 0 : 0.5,
    y: placedHeight % 2 === 0 ? 0 : 0.5,
  };
}

/**
 * One entity occupies one or more consecutive rows (chunked at CASES_PER_ROW).
 * Flat 4-wide packing mixes single-pose entities into neighbors' direction rows.
 */
function placementCaseRows(
  spec: PageSpec,
  renderDb: RenderDb,
  diagnostics: OfficialModSuiteManifest["rendererDiagnostics"],
): PlacementCase[][] {
  const rows: PlacementCase[][] = [];

  for (const name of spec.entities ?? []) {
    const def = renderDb.entities[name];
    if (!def) throw new Error(`Missing render metadata for ${name}`);
    const entityCases: EntityCase[] = posesForEntity(name, def, {
      renderDbMetadataSource: "official-mod-render-db",
    }).map((pose) => ({
      kind: "entity",
      name,
      pose,
      bounds: entityBounds(name, pose, renderDb, diagnostics),
      lattice: entityLattice(name, pose, renderDb),
    }));
    rows.push(...chunk(entityCases, CASES_PER_ROW));
  }

  const tileCases: TileCase[] = (spec.tiles ?? []).map((name) => ({
    kind: "tile",
    name,
    bounds: { left: 0, top: 0, right: TILE_PATCH_SIZE, bottom: TILE_PATCH_SIZE },
    lattice: { x: 0, y: 0 },
  }));
  rows.push(...chunk(tileCases, CASES_PER_ROW));

  return rows;
}

function buildPage(
  spec: PageSpec,
  mod: string,
  renderDb: RenderDb,
  diagnostics: OfficialModSuiteManifest["rendererDiagnostics"],
): PageDraft {
  const entities: BlueprintEntity[] = [];
  const tiles: Tile[] = [];
  const cells: OfficialModSuiteCell[] = [];
  const caseRows = placementCaseRows(spec, renderDb, diagnostics);
  let nextEntityNumber = 1;
  let rowTop = 0;

  for (const row of caseRows) {
    let previousRight: number | null = null;
    let rowBottom = rowTop;

    for (const placement of row) {
      const minimumLeft = previousRight == null ? 0 : previousRight + CASE_GAP_TILES;
      const translateX = packedTranslation(minimumLeft, placement.bounds.left, placement.lattice.x);
      const translateY = packedTranslation(rowTop, placement.bounds.top, placement.lattice.y);
      const placedBounds = {
        left: cleanCoordinate(placement.bounds.left + translateX),
        top: cleanCoordinate(placement.bounds.top + translateY),
        right: cleanCoordinate(placement.bounds.right + translateX),
        bottom: cleanCoordinate(placement.bounds.bottom + translateY),
      };
      previousRight = placedBounds.right;
      rowBottom = Math.max(rowBottom, placedBounds.bottom);

      let focusEntityNumbers: number[] = [];
      if (placement.kind === "entity") {
        const entityNumber = nextEntityNumber++;
        focusEntityNumbers = [entityNumber];
        const placed = entityBlueprintFields(placement.name, placement.pose);
        entities.push({
          ...placed,
          entity_number: entityNumber,
          position: { x: translateX, y: translateY },
        });
      } else {
        for (let y = 0; y < TILE_PATCH_SIZE; y++) {
          for (let x = 0; x < TILE_PATCH_SIZE; x++) {
            tiles.push({
              name: placement.name,
              position: { x: translateX + x, y: translateY + y },
            });
          }
        }
      }

      cells.push({
        id:
          placement.kind === "entity"
            ? poseCellId(placement.name, placement.pose)
            : `tile/${mod}/${placement.name}`,
        caseKind: placement.kind === "entity" ? "entity-pose" : "tile-patch",
        pageId: spec.id,
        pagePath: [],
        cropTiles: {
          left: placedBounds.left - CROP_MARGIN_TILES,
          top: placedBounds.top - CROP_MARGIN_TILES,
          right: placedBounds.right + CROP_MARGIN_TILES,
          bottom: placedBounds.bottom + CROP_MARGIN_TILES,
        },
        focusEntityNumbers,
        ...(placement.kind === "entity"
          ? {
              entityName: placement.name,
              pose: placement.pose,
            }
          : {
              tileName: placement.name,
              tilePatch: { width: TILE_PATCH_SIZE, height: TILE_PATCH_SIZE },
            }),
      });
    }

    rowTop = rowBottom + CASE_GAP_TILES;
  }

  return {
    spec,
    mod,
    cells,
    blueprint: {
      item: "blueprint",
      label: spec.label,
      icons: itemIcons(...spec.icons),
      description: `Generated FPSR ${mod} placement page.`,
      version: BLUEPRINT_VERSION,
      ...(entities.length > 0 ? { entities } : {}),
      ...(tiles.length > 0 ? { tiles } : {}),
    },
  };
}

function buildSpecBook(
  spec: BookSpec,
  mod: string,
  bookSpecId: string,
  pathPrefix: number[],
  renderDb: RenderDb,
  diagnostics: OfficialModSuiteManifest["rendererDiagnostics"],
  pages: OfficialModSuitePage[],
  cells: OfficialModSuiteCell[],
): BlueprintBook {
  const entries: NonNullable<BlueprintBook["blueprints"]> = [];

  spec.children.forEach((child, index) => {
    const path = [...pathPrefix, index];
    if (child.kind === "book") {
      entries.push({
        index,
        blueprint_book: buildSpecBook(
          child,
          mod,
          bookSpecId,
          path,
          renderDb,
          diagnostics,
          pages,
          cells,
        ),
      });
      return;
    }

    const draft = buildPage(child, mod, renderDb, diagnostics);
    for (const cell of draft.cells) cell.pagePath = path;
    pages.push({
      id: child.id,
      label: child.label,
      sectionId: "official-mods",
      groupId: mod,
      bookSpecId,
      path,
      cellIds: draft.cells.map((cell) => cell.id),
      entityCount: draft.blueprint.entities?.length ?? 0,
      tileCount: draft.blueprint.tiles?.length ?? 0,
    });
    cells.push(...draft.cells);
    entries.push({ index, blueprint: draft.blueprint });
  });

  return makeBook(spec.label, spec.icons, entries);
}

function allEntryIcons(spec: BookSpec): string[] {
  return [
    ...spec.icons,
    ...spec.children.flatMap((child) =>
      child.kind === "book" ? allEntryIcons(child) : [...child.icons],
    ),
  ];
}

function assertFoundation(renderDb: RenderDb, specs: readonly FactorioModBookSpec[]): void {
  if (
    renderDb.gameVersion !== BASE_GAME_VERSION ||
    renderDb.mods.length !== OFFICIAL_MOD_PROFILE.length ||
    !renderDb.mods.every((mod, index) => mod === OFFICIAL_MOD_PROFILE[index])
  ) {
    throw new Error(
      `Official-mod suite requires exact ${BASE_GAME_VERSION} [${OFFICIAL_MOD_PROFILE.join(", ")}]; ` +
        `got ${renderDb.gameVersion} [${renderDb.mods.join(", ")}]`,
    );
  }

  const issues = specs.flatMap((spec) =>
    validateModBookSpec(spec).map((issue) => `${spec.mod}: ${issue}`),
  );
  const expectedSpecMods = OFFICIAL_MOD_PROFILE.slice(1);
  const specMods = specs.map((spec) => spec.mod);
  if (
    specMods.length !== expectedSpecMods.length ||
    [...specMods].sort().join(",") !== [...expectedSpecMods].sort().join(",")
  ) {
    issues.push(`expected one spec for each official mod: ${expectedSpecMods.join(", ")}`);
  }
  for (const spec of specs) {
    if (spec.gameVersion !== BASE_GAME_VERSION) {
      issues.push(
        `${spec.mod}: expected game version ${BASE_GAME_VERSION}; got ${spec.gameVersion}`,
      );
    }
  }
  const officialEntities = specs.flatMap(entityNamesInBook);
  const officialTiles = specs.flatMap(tileNamesInBook);
  for (const name of new Set(officialEntities)) {
    if (officialEntities.filter((candidate) => candidate === name).length > 1) {
      issues.push(`entity is owned by more than one mod spec: ${name}`);
    }
  }
  for (const name of new Set(officialTiles)) {
    if (officialTiles.filter((candidate) => candidate === name).length > 1) {
      issues.push(`tile is owned by more than one mod spec: ${name}`);
    }
  }
  const expectedEntities = new Set([...BASE_ENTITY_NAMES, ...officialEntities]);
  const expectedTiles = new Set([...BASE_TILE_NAMES, ...officialTiles]);
  const renderEntities = new Set(Object.keys(renderDb.entities));
  const renderTiles = new Set(Object.keys(renderDb.tiles));

  for (const name of expectedEntities) {
    if (!renderEntities.has(name)) issues.push(`missing render entity: ${name}`);
  }
  for (const name of renderEntities) {
    if (!expectedEntities.has(name)) issues.push(`unowned render entity: ${name}`);
  }
  for (const name of expectedTiles) {
    if (!renderTiles.has(name)) issues.push(`missing render tile: ${name}`);
  }
  for (const name of renderTiles) {
    if (!expectedTiles.has(name)) issues.push(`unowned render tile: ${name}`);
  }
  for (const spec of specs) {
    for (const name of allEntryIcons(spec)) {
      if (renderDb.icons[`item/${name}`] == null)
        issues.push(`${spec.mod}: missing item icon ${name}`);
    }
  }

  if (issues.length > 0)
    throw new Error(`Invalid official-mod book foundation:\n- ${issues.join("\n- ")}`);
}

export function buildOfficialModSuite(renderDb: RenderDb): OfficialModSuiteBuild {
  const specs = OFFICIAL_MOD_BOOK_SPECS;
  assertFoundation(renderDb, specs);

  const pages: OfficialModSuitePage[] = [];
  const cells: OfficialModSuiteCell[] = [];
  const rendererDiagnostics: OfficialModSuiteManifest["rendererDiagnostics"] = [];
  const books: OfficialModSuiteBook[] = specs.map((spec) => ({
    specId: spec.id,
    mod: spec.mod,
    file: `${spec.mod}.bp.txt`,
    document: {
      blueprint_book: buildSpecBook(
        spec,
        spec.mod,
        spec.id,
        [],
        renderDb,
        rendererDiagnostics,
        pages,
        cells,
      ),
    },
  }));

  const manifest: OfficialModSuiteManifest = {
    schema: 1,
    suiteId: "official-mods-2.1.11",
    gameVersion: BASE_GAME_VERSION,
    requiredMods: [...OFFICIAL_MOD_PROFILE],
    books: books.map(({ specId, mod, file }) => ({ specId, mod, file })),
    canaryPageIds: [
      "official-mods/elevated-rails/logistics",
      "official-mods/recycler/recycler",
      "official-mods/space-age/space",
      "official-mods/space-age/logistics",
    ],
    inventory: {
      source: "per-mod-book-specs",
      specs: specs.map((spec) => ({
        mod: spec.mod,
        specId: spec.id,
        entityCount: entityNamesInBook(spec).length,
        tileCount: tileNamesInBook(spec).length,
        emitted: pagesInBook(spec).length > 0,
      })),
    },
    renderMetadata: {
      role: "exact-all-official-graphics-metadata",
      gameVersion: renderDb.gameVersion,
      mods: [...renderDb.mods],
    },
    rendererDiagnostics,
    contract: {
      covered: [
        "Every placeable entity and tile owned by Elevated Rails, Recycler, and Space Age 2.1.11",
        "Every available direction and underground/loader input-output pose per owned entity",
        "One 7×7 patch per owned tile",
        "Independent per-mod inventory ownership composed under the exact all-official profile",
      ],
      deferred: [
        "Orientation, connectivity, runtime-state, recipe, module, filter, and circuit matrices",
        "Quality item/icon and quality-state coverage because Quality owns no placeable entity or tile",
        "Renderer correctness; planner failures are recorded in rendererDiagnostics and use selection-box packing",
        "Surface-specific real-game placement for planetary and space-platform entities and tiles",
      ],
    },
    coverage: {
      entityPrototypeCount: new Set(
        cells
          .filter((cell) => cell.caseKind === "entity-pose")
          .map((cell) => cell.entityName)
          .filter((name): name is string => name != null),
      ).size,
      entityPlacementCaseCount: cells.filter((cell) => cell.caseKind === "entity-pose").length,
      tilePrototypeCount: new Set(
        cells
          .filter((cell) => cell.caseKind === "tile-patch")
          .map((cell) => cell.tileName)
          .filter((name): name is string => name != null),
      ).size,
      tileCaseCount: cells.filter((cell) => cell.caseKind === "tile-patch").length,
      pageCount: pages.length,
    },
    pages,
    cells,
  };

  return { books, manifest };
}
