import {
  decode,
  encode,
  selectBlueprint,
  type Blueprint,
  type BlueprintDocument,
} from "@rickyzhangca/fpsr";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { planShotView, type ShotView } from "./frame.js";
import { FACTORIO_BIN, GROUND_TRUTH_OUT, REPO_ROOT } from "./paths.js";
import { assertAssetProfile, assertFactorioVersion, type ExactProfile } from "./profile.js";
import { shootJobs } from "./shoot.js";

export type VisualCaseKind = "entity-pose" | "adjacency-mask" | "belt-neighborhood" | "tile-patch";

export interface VisualSuiteCell {
  id: string;
  caseKind: VisualCaseKind;
  pageId: string;
  pagePath: number[];
  cropTiles: { left: number; top: number; right: number; bottom: number };
  focusEntityNumbers: number[];
  entityName?: string;
  tileName?: string;
  pose?: {
    axis: "single" | "direction" | "orientation";
    direction?: number;
    orientation?: number;
  };
}

export interface VisualSuitePage {
  id: string;
  label: string;
  sectionId: string;
  groupId: string;
  bookSpecId?: string;
  path: number[];
  cellIds: string[];
  entityCount: number;
  tileCount: number;
}

export interface VisualSuiteBook {
  specId: string;
  mod: string;
  file: string;
}

export interface VisualSuiteManifest {
  schema: 1;
  suiteId: string;
  gameVersion: string;
  requiredMods: string[];
  canaryPageIds: string[];
  books?: VisualSuiteBook[];
  pages: VisualSuitePage[];
  cells: VisualSuiteCell[];
}

export interface LoadedVisualBook {
  specId: string;
  file: string;
  source: string;
  document: BlueprintDocument;
  sha256: string;
}

export interface LoadedVisualSuite {
  dir: string;
  bookSource: string;
  document: BlueprintDocument;
  books?: Record<string, LoadedVisualBook>;
  manifestSource: string;
  manifest: VisualSuiteManifest;
  bookSha256: string;
  manifestSha256: string;
}

export interface SelectedVisualPage {
  page: VisualSuitePage;
  cells: VisualSuiteCell[];
  blueprint: Blueprint;
  blueprintString: string;
  blueprintSha256: string;
  captureName: string;
}

export type PageSelection =
  | { kind: "canary" }
  | { kind: "all" }
  | { kind: "ids"; pageIds: string[] };

export interface ReferencePageEntry {
  pageId: string;
  pagePath: number[];
  captureName: string;
  file: string;
  blueprintSha256: string;
  pngSha256: string;
  view: ShotView;
}

export interface ReferenceIndex {
  schema: 1;
  suiteId: string;
  gameVersion: string;
  mods: string[];
  pixelsPerTile: number;
  bookSha256: string;
  manifestSha256: string;
  pages: Record<string, ReferencePageEntry>;
}

export const BASE_SUITE_DIR = path.join(REPO_ROOT, "fixtures/visual-tests/base-game");
export const DEFAULT_BASE_ASSETS_DIR = path.join(REPO_ROOT, "assets-out/2.1.11-base");

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizePageId(pageId: string): string {
  const name = pageId.replace(/[^a-zA-Z0-9._-]+/g, "--");
  if (!name) throw new Error(`Cannot sanitize visual page id: ${pageId}`);
  return name;
}

function exactProfile(suite: LoadedVisualSuite): ExactProfile {
  return {
    gameVersion: suite.manifest.gameVersion,
    mods: suite.manifest.requiredMods,
  };
}

function assertManifest(value: unknown, filename: string): asserts value is VisualSuiteManifest {
  const manifest = value as Partial<VisualSuiteManifest>;
  if (
    manifest.schema !== 1 ||
    typeof manifest.suiteId !== "string" ||
    typeof manifest.gameVersion !== "string" ||
    !Array.isArray(manifest.requiredMods) ||
    !Array.isArray(manifest.canaryPageIds) ||
    !manifest.canaryPageIds.every((id) => typeof id === "string") ||
    !Array.isArray(manifest.pages) ||
    !Array.isArray(manifest.cells) ||
    (manifest.books != null &&
      (!Array.isArray(manifest.books) ||
        !manifest.books.every(
          (book) =>
            typeof book.specId === "string" &&
            typeof book.mod === "string" &&
            typeof book.file === "string",
        )))
  ) {
    throw new Error(`Invalid visual-suite manifest at ${filename}`);
  }
}

function pageDocument(suite: LoadedVisualSuite, page: VisualSuitePage): BlueprintDocument {
  if (page.bookSpecId) {
    const book = suite.books?.[page.bookSpecId];
    if (!book) throw new Error(`Page ${page.id} references unknown book ${page.bookSpecId}`);
    return book.document;
  }
  return suite.document;
}

export async function loadVisualSuite(dir = BASE_SUITE_DIR): Promise<LoadedVisualSuite> {
  const root = path.resolve(dir);
  const manifestSource = await readFile(path.join(root, "manifest.json"), "utf8");
  const manifestValue: unknown = JSON.parse(manifestSource);
  assertManifest(manifestValue, path.join(root, "manifest.json"));

  let bookSource: string;
  let document: BlueprintDocument;
  let books: Record<string, LoadedVisualBook> | undefined;

  if (manifestValue.books) {
    books = {};
    const sources: string[] = [];
    for (const entry of manifestValue.books) {
      const source = (await readFile(path.join(root, entry.file), "utf8")).trim();
      sources.push(source);
      books[entry.specId] = {
        specId: entry.specId,
        file: entry.file,
        source,
        document: decode(source),
        sha256: sha256(source),
      };
    }
    bookSource = sources.join("\n");
    document = books[manifestValue.books[0]!.specId]!.document;
  } else {
    bookSource = (await readFile(path.join(root, "book.bp.txt"), "utf8")).trim();
    document = decode(bookSource);
  }

  const suite: LoadedVisualSuite = {
    dir: root,
    bookSource,
    document,
    books,
    manifestSource,
    manifest: manifestValue,
    bookSha256: sha256(bookSource),
    manifestSha256: sha256(manifestSource),
  };

  const pageIds = new Set<string>();
  const cellIds = new Set<string>();
  for (const page of manifestValue.pages) {
    if (pageIds.has(page.id)) throw new Error(`Duplicate visual page id: ${page.id}`);
    pageIds.add(page.id);
    const blueprint = selectBlueprint(pageDocument(suite, page), page.path);
    if (blueprint.label !== page.label) {
      throw new Error(`Page ${page.id} label/path does not match the committed book`);
    }
  }
  for (const cell of manifestValue.cells) {
    if (cellIds.has(cell.id)) throw new Error(`Duplicate visual cell id: ${cell.id}`);
    cellIds.add(cell.id);
    if (!pageIds.has(cell.pageId)) throw new Error(`Cell ${cell.id} references missing page`);
  }
  for (const page of manifestValue.pages) {
    for (const cellId of page.cellIds) {
      const cell = manifestValue.cells.find((entry) => entry.id === cellId);
      if (!cell || cell.pageId !== page.id) {
        throw new Error(`Page ${page.id} has inconsistent cell ${cellId}`);
      }
    }
  }

  return suite;
}

function canaryPageIds(suite: LoadedVisualSuite): string[] {
  if (suite.manifest.canaryPageIds.length === 0) {
    throw new Error(`Visual suite ${suite.manifest.suiteId} declares no canary pages`);
  }
  const result = [...new Set(suite.manifest.canaryPageIds)];
  for (const pageId of result) {
    if (!suite.manifest.pages.some((page) => page.id === pageId)) {
      throw new Error(`Visual suite canary references missing page: ${pageId}`);
    }
  }
  return result;
}

export function selectVisualPages(
  suite: LoadedVisualSuite,
  selection: PageSelection,
): SelectedVisualPage[] {
  const pageIds =
    selection.kind === "all"
      ? suite.manifest.pages.map((page) => page.id)
      : selection.kind === "canary"
        ? canaryPageIds(suite)
        : selection.pageIds;
  const uniqueIds = [...new Set(pageIds)];
  return uniqueIds.map((pageId) => {
    const page = suite.manifest.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error(`Unknown visual-suite page: ${pageId}`);
    const blueprint = selectBlueprint(pageDocument(suite, page), page.path);
    const blueprintString = encode({ blueprint });
    const cells = page.cellIds.map((cellId) => {
      const cell = suite.manifest.cells.find((entry) => entry.id === cellId);
      if (!cell) throw new Error(`Missing cell ${cellId} for page ${page.id}`);
      return cell;
    });
    return {
      page,
      cells,
      blueprint,
      blueprintString,
      blueprintSha256: sha256(blueprintString),
      captureName: sanitizePageId(page.id),
    };
  });
}

export function referenceDir(suite: LoadedVisualSuite, pixelsPerTile: number): string {
  return path.join(
    GROUND_TRUTH_OUT,
    suite.manifest.suiteId,
    `ppt-${String(pixelsPerTile).replace(/[^0-9.-]+/g, "-")}`,
  );
}

export function referenceIndexPath(suite: LoadedVisualSuite, pixelsPerTile: number): string {
  return path.join(referenceDir(suite, pixelsPerTile), "index.json");
}

export async function readReferenceIndex(
  suite: LoadedVisualSuite,
  pixelsPerTile: number,
): Promise<ReferenceIndex> {
  const filename = referenceIndexPath(suite, pixelsPerTile);
  const index = JSON.parse(await readFile(filename, "utf8")) as ReferenceIndex;
  if (index.schema !== 1 || index.suiteId !== suite.manifest.suiteId) {
    throw new Error(`Invalid reference index at ${filename}`);
  }
  return index;
}

export function assertReferenceIndexProfile(
  suite: LoadedVisualSuite,
  index: ReferenceIndex,
  pixelsPerTile: number,
): void {
  const exact =
    index.gameVersion === suite.manifest.gameVersion &&
    index.mods.length === suite.manifest.requiredMods.length &&
    index.mods.every((mod, i) => mod === suite.manifest.requiredMods[i]) &&
    index.pixelsPerTile === pixelsPerTile;
  if (!exact) throw new Error("Game reference index does not match the suite capture profile");
}

function newReferenceIndex(suite: LoadedVisualSuite, pixelsPerTile: number): ReferenceIndex {
  return {
    schema: 1,
    suiteId: suite.manifest.suiteId,
    gameVersion: suite.manifest.gameVersion,
    mods: [...suite.manifest.requiredMods],
    pixelsPerTile,
    bookSha256: suite.bookSha256,
    manifestSha256: suite.manifestSha256,
    pages: {},
  };
}

async function loadOrCreateReferenceIndex(
  suite: LoadedVisualSuite,
  pixelsPerTile: number,
): Promise<ReferenceIndex> {
  try {
    const index = await readReferenceIndex(suite, pixelsPerTile);
    assertReferenceIndexProfile(suite, index, pixelsPerTile);
    const expected = exactProfile(suite);
    const matches =
      index.gameVersion === expected.gameVersion &&
      index.mods.length === expected.mods.length &&
      index.mods.every((mod, i) => mod === expected.mods[i]) &&
      index.pixelsPerTile === pixelsPerTile;
    if (!matches) {
      throw new Error(
        `Reference index profile differs from ${expected.gameVersion} [${expected.mods.join(", ")}] ` +
          `at ${pixelsPerTile} ppt`,
      );
    }
    return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return newReferenceIndex(suite, pixelsPerTile);
    }
    throw error;
  }
}

export async function planVisualPages(
  pages: SelectedVisualPage[],
  options: { pixelsPerTile: number; assetsDir: string },
): Promise<Map<string, ShotView>> {
  const views = new Map<string, ShotView>();
  for (const page of pages) {
    views.set(
      page.page.id,
      await planShotView({
        blueprint: page.blueprintString,
        pixelsPerTile: options.pixelsPerTile,
        altMode: false,
        padTiles: 0,
        assetsDir: options.assetsDir,
      }),
    );
  }
  return views;
}

export async function captureVisualPages(
  suite: LoadedVisualSuite,
  pages: SelectedVisualPage[],
  options: {
    pixelsPerTile: number;
    assetsDir: string;
    batchSize?: number;
    factorioBin?: string;
  },
): Promise<ReferenceIndex> {
  if (pages.length === 0) throw new Error("No visual pages selected for capture");
  const profile = exactProfile(suite);
  const factorioBin = options.factorioBin ?? FACTORIO_BIN;
  await Promise.all([
    assertFactorioVersion(profile.gameVersion, factorioBin),
    assertAssetProfile(options.assetsDir, profile),
  ]);
  const views = await planVisualPages(pages, options);
  const outputDir = referenceDir(suite, options.pixelsPerTile);
  const batchSize = options.batchSize ?? 8;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid capture batch size: ${batchSize}`);
  }
  const index = await loadOrCreateReferenceIndex(suite, options.pixelsPerTile);

  for (let offset = 0; offset < pages.length; offset += batchSize) {
    const batch = pages.slice(offset, offset + batchSize);
    console.log(
      `visual-suite: capture batch ${Math.floor(offset / batchSize) + 1}/${Math.ceil(pages.length / batchSize)} ` +
        `(${batch.length} pages)`,
    );
    await shootJobs(
      batch.map((page) => ({
        name: page.captureName,
        blueprint: page.blueprintString,
        showEntityInfo: false,
        view: views.get(page.page.id),
      })),
      {
        pixelsPerTile: options.pixelsPerTile,
        assetsDir: options.assetsDir,
        expectedGameVersion: profile.gameVersion,
        enabledMods: profile.mods,
        factorioBin,
        outputDir,
      },
    );

    for (const page of batch) {
      const file = `${page.captureName}.game.png`;
      const bytes = await readFile(path.join(outputDir, file));
      const view = views.get(page.page.id);
      if (!view) throw new Error(`Missing planned view for ${page.page.id}`);
      index.pages[page.page.id] = {
        pageId: page.page.id,
        pagePath: [...page.page.path],
        captureName: page.captureName,
        file,
        blueprintSha256: page.blueprintSha256,
        pngSha256: sha256(bytes),
        view,
      };
    }
    index.bookSha256 = suite.bookSha256;
    index.manifestSha256 = suite.manifestSha256;
    await writeFile(
      referenceIndexPath(suite, options.pixelsPerTile),
      `${JSON.stringify(index, null, 2)}\n`,
    );
  }
  return index;
}

export function assertReferenceFresh(
  suite: LoadedVisualSuite,
  page: SelectedVisualPage,
  index: ReferenceIndex,
): ReferencePageEntry {
  const entry = index.pages[page.page.id];
  if (!entry) throw new Error(`Missing game reference for page ${page.page.id}`);
  if (entry.blueprintSha256 !== page.blueprintSha256) {
    throw new Error(`Stale game reference for page ${page.page.id}: blueprint content changed`);
  }
  if (entry.pagePath.join(".") !== page.page.path.join(".")) {
    throw new Error(`Stale game reference for page ${page.page.id}: manifest path changed`);
  }
  return entry;
}
