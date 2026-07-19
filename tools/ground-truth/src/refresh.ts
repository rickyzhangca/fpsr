/**
 * Clear fixtures/ground-truth/*.game.png and re-shoot every golden case
 * derived from fixtures/golden/cases.json + visual-test books in one Factorio launch.
 *
 * Camera framing comes from fpsr planDrawList bounds (same as golden renders).
 * Quit any running Factorio instance first (user-data lock).
 */
import { decode, encode, selectBlueprint } from "fpsr";
import { readFileSync } from "node:fs";
import { access, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { GROUND_TRUTH_OUT, REPO_ROOT } from "./paths.js";
import { shootJobs } from "./shoot.js";

// Mirror @fpsr/golden-tests case loading without a workspace dependency.
type GoldenCase = {
  name: string;
  bp: string;
  ppt: number;
  alt: boolean;
  blueprintPath?: number[];
};

type GoldenCasesConfig = {
  selection: "canary" | "all";
  ppt: number;
};

type VisualSuiteBook = {
  specId: string;
  mod: string;
  file: string;
};

type VisualSuitePage = {
  id: string;
  path: number[];
  bookSpecId?: string;
};

type VisualSuiteManifest = {
  schema: 1;
  canaryPageIds: string[];
  books?: VisualSuiteBook[];
  pages: VisualSuitePage[];
};

const CASES_PATH = path.join(REPO_ROOT, "fixtures/golden/cases.json");
const VISUAL_SUITE_DIRS = [
  path.join(REPO_ROOT, "fixtures/visual-tests/base-game"),
  path.join(REPO_ROOT, "fixtures/visual-tests/official-mods"),
] as const;

function sanitizePageId(pageId: string): string {
  const name = pageId.replace(/[^a-zA-Z0-9._-]+/g, "--");
  if (!name) throw new Error(`Cannot sanitize visual page id: ${pageId}`);
  return name;
}

async function clearGroundTruths(): Promise<string[]> {
  await mkdir(GROUND_TRUTH_OUT, { recursive: true });
  const entries = await readdir(GROUND_TRUTH_OUT);
  const removed: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".game.png")) continue;
    await unlink(path.join(GROUND_TRUTH_OUT, name));
    removed.push(name);
  }
  return removed;
}

function loadConfig(raw: unknown): GoldenCasesConfig {
  const config = raw as Partial<GoldenCasesConfig>;
  if (config.selection !== "canary" && config.selection !== "all") {
    throw new Error(`fixtures/golden/cases.json: selection must be "canary" or "all"`);
  }
  if (typeof config.ppt !== "number" || !Number.isFinite(config.ppt) || config.ppt <= 0) {
    throw new Error(`fixtures/golden/cases.json: ppt must be a positive number`);
  }
  return { selection: config.selection, ppt: config.ppt };
}

function loadManifest(dir: string): VisualSuiteManifest {
  const file = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Partial<VisualSuiteManifest>;
  if (
    manifest.schema !== 1 ||
    !Array.isArray(manifest.canaryPageIds) ||
    !manifest.canaryPageIds.every((id) => typeof id === "string") ||
    !Array.isArray(manifest.pages)
  ) {
    throw new Error(`Invalid visual-suite manifest at ${file}`);
  }
  return manifest as VisualSuiteManifest;
}

function bookFileForPage(
  dir: string,
  manifest: VisualSuiteManifest,
  page: VisualSuitePage,
): string {
  if (manifest.books) {
    if (!page.bookSpecId) {
      throw new Error(`Page ${page.id} is missing bookSpecId in ${dir}`);
    }
    const book = manifest.books.find((entry) => entry.specId === page.bookSpecId);
    if (!book) {
      throw new Error(`Page ${page.id} references unknown book ${page.bookSpecId}`);
    }
    return path.join(dir, book.file);
  }
  return path.join(dir, "book.bp.txt");
}

function casesFromSuite(dir: string, selection: "canary" | "all", ppt: number): GoldenCase[] {
  const manifest = loadManifest(dir);
  const pageIds =
    selection === "all"
      ? manifest.pages.map((page) => page.id)
      : [...new Set(manifest.canaryPageIds)];

  return pageIds.map((pageId) => {
    const page = manifest.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error(`Visual suite canary/page missing: ${pageId} in ${dir}`);
    const bookAbs = bookFileForPage(dir, manifest, page);
    return {
      name: sanitizePageId(page.id),
      bp: path.relative(REPO_ROOT, bookAbs),
      ppt,
      alt: false,
      blueprintPath: [...page.path],
    };
  });
}

async function loadCases(): Promise<GoldenCase[]> {
  const config = loadConfig(JSON.parse(await readFile(CASES_PATH, "utf8")));
  const cases = VISUAL_SUITE_DIRS.flatMap((dir) =>
    casesFromSuite(dir, config.selection, config.ppt),
  );
  if (cases.length === 0) {
    throw new Error(`No golden cases derived from visual-test books`);
  }
  return cases;
}

async function leafBlueprintString(c: GoldenCase): Promise<string> {
  const bookPath = path.resolve(REPO_ROOT, c.bp);
  await access(bookPath);
  const doc = decode((await readFile(bookPath, "utf8")).trim());
  const blueprint = selectBlueprint(doc, c.blueprintPath);
  return encode({ blueprint });
}

async function main(): Promise<void> {
  const cases = await loadCases();
  console.log(`ground-truth refresh: ${cases.length} case(s), framing from fpsr draw-list bounds`);
  const removed = await clearGroundTruths();
  console.log(
    removed.length === 0
      ? "ground-truth refresh: no existing *.game.png to clear"
      : `ground-truth refresh: cleared ${removed.join(", ")}`,
  );

  // Group by ppt so each Factorio launch still works; usually all share ppt=64.
  const byPpt = new Map<number, GoldenCase[]>();
  for (const c of cases) {
    const list = byPpt.get(c.ppt) ?? [];
    list.push(c);
    byPpt.set(c.ppt, list);
  }

  let written = 0;
  for (const [ppt, group] of byPpt) {
    const jobs = [];
    for (const c of group) {
      jobs.push({
        name: c.name,
        blueprint: await leafBlueprintString(c),
        showEntityInfo: c.alt,
      });
    }
    await shootJobs(jobs, { pixelsPerTile: ppt, padTiles: 0 });
    written += jobs.length;
  }

  console.log(`\nground-truth refresh: wrote ${written} file(s) to ${GROUND_TRUTH_OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
