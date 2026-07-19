import { readFileSync } from "node:fs";
import path from "node:path";
import { GOLDEN_DIR, REPO_ROOT } from "./paths.js";

export interface GoldenCase {
  name: string;
  /** Repo-relative path to a blueprint book (or leaf blueprint). */
  bp: string;
  ppt: number;
  alt: boolean;
  /** Path into a blueprint book; omit for a leaf blueprint document. */
  blueprintPath?: number[];
}

interface GoldenCasesConfig {
  selection: "canary" | "all";
  ppt: number;
}

interface VisualSuiteBook {
  specId: string;
  mod: string;
  file: string;
}

interface VisualSuitePage {
  id: string;
  path: number[];
  bookSpecId?: string;
}

interface VisualSuiteManifest {
  schema: 1;
  canaryPageIds: string[];
  books?: VisualSuiteBook[];
  pages: VisualSuitePage[];
}

const VISUAL_SUITE_DIRS = [
  path.join(REPO_ROOT, "fixtures/visual-tests/base-game"),
  path.join(REPO_ROOT, "fixtures/visual-tests/official-mods"),
] as const;

function sanitizePageId(pageId: string): string {
  const name = pageId.replace(/[^a-zA-Z0-9._-]+/g, "--");
  if (!name) throw new Error(`Cannot sanitize visual page id: ${pageId}`);
  return name;
}

function loadConfig(): GoldenCasesConfig {
  const raw = JSON.parse(
    readFileSync(path.join(GOLDEN_DIR, "cases.json"), "utf8"),
  ) as Partial<GoldenCasesConfig>;
  if (raw.selection !== "canary" && raw.selection !== "all") {
    throw new Error(`fixtures/golden/cases.json: selection must be "canary" or "all"`);
  }
  if (typeof raw.ppt !== "number" || !Number.isFinite(raw.ppt) || raw.ppt <= 0) {
    throw new Error(`fixtures/golden/cases.json: ppt must be a positive number`);
  }
  return { selection: raw.selection, ppt: raw.ppt };
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

export function loadCases(): GoldenCase[] {
  const config = loadConfig();
  return VISUAL_SUITE_DIRS.flatMap((dir) => casesFromSuite(dir, config.selection, config.ppt));
}

export function bpPath(c: GoldenCase): string {
  return path.resolve(REPO_ROOT, c.bp);
}

export function goldenPngPath(c: GoldenCase): string {
  return path.join(GOLDEN_DIR, `${c.name}.png`);
}
