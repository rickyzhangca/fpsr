#!/usr/bin/env tsx

import path from "node:path";
import { access } from "node:fs/promises";
import { FACTORIO_BIN, REPO_ROOT } from "./paths.js";
import { inspectFactorioVersion, readAssetProfile } from "./profile.js";
import { compareVisualPages } from "./visual-compare.js";
import {
  BASE_SUITE_DIR,
  DEFAULT_BASE_ASSETS_DIR,
  assertReferenceIndexProfile,
  assertReferenceFresh,
  captureVisualPages,
  loadVisualSuite,
  readReferenceIndex,
  selectVisualPages,
  type PageSelection,
} from "./visual-suite.js";

interface CliOptions {
  audit: boolean;
  capture: boolean;
  compare: boolean;
  selection: PageSelection;
  pixelsPerTile: number;
  batchSize: number;
  pixelThreshold: number;
  maxDiffPercent: number;
  assetsDir: string;
  factorioBin: string;
  suiteDir: string;
}

function usage(): string {
  return [
    "Usage: pnpm -F @fpsr/ground-truth run suite:audit",
    "       pnpm -F @fpsr/ground-truth run suite:canary",
    "       pnpm -F @fpsr/ground-truth run suite:all",
    "       tsx src/base-suite-cli.ts [--audit] [--capture] [--compare] [selection] [options]",
    "",
    "Modes (may be combined):",
    "  --audit             Validate suite, exact runtime/assets, and reference freshness (default)",
    "  --capture           Capture selected pages with real Factorio into fixtures/ground-truth/",
    "  --compare           Render selected pages, crop every manifest cell, and write a diff report",
    "",
    "Selection:",
    "  --canary            Five deterministic pages: direction/orientation/mask/belt/tile (default)",
    "  --all               All manifest pages",
    "  --page <id>         One page id; repeat for multiple pages",
    "",
    "Options:",
    "  --ppt <n>           Pixels per tile (default: 64)",
    "  --batch-size <n>    Pages per Factorio launch (default: 8)",
    "  --assets <dir>      Exact Base-only asset bundle (default: assets-out/2.1.11-base)",
    "  --factorio <bin>    Factorio executable (default: /Applications/factorio.app/.../factorio)",
    "  --suite <dir>       Visual suite directory (default: fixtures/visual-tests/base-game)",
    "  --threshold <n>     pixelmatch threshold (default: 0.1)",
    "  --max-diff <pct>    Maximum differing pixels per cell, percent (default: 0.1)",
  ].join("\n");
}

function positiveNumber(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} requires a positive number`);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  let audit = false;
  let capture = false;
  let compare = false;
  let selection: PageSelection = { kind: "canary" };
  const pageIds: string[] = [];
  let pixelsPerTile = 64;
  let batchSize = 8;
  let pixelThreshold = 0.1;
  let maxDiffPercent = 0.1;
  let assetsDir = DEFAULT_BASE_ASSETS_DIR;
  let factorioBin = FACTORIO_BIN;
  let suiteDir = BASE_SUITE_DIR;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg || arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--audit") {
      audit = true;
      continue;
    }
    if (arg === "--capture") {
      capture = true;
      continue;
    }
    if (arg === "--compare") {
      compare = true;
      continue;
    }
    if (arg === "--canary") {
      selection = { kind: "canary" };
      continue;
    }
    if (arg === "--all") {
      selection = { kind: "all" };
      continue;
    }
    if (arg === "--page") {
      const value = argv[++index];
      if (!value) throw new Error("--page requires a manifest page id");
      pageIds.push(value);
      continue;
    }
    if (arg === "--ppt") {
      pixelsPerTile = positiveNumber(argv[++index], arg);
      continue;
    }
    if (arg === "--batch-size") {
      batchSize = positiveNumber(argv[++index], arg);
      if (!Number.isInteger(batchSize)) throw new Error("--batch-size must be an integer");
      continue;
    }
    if (arg === "--threshold") {
      pixelThreshold = positiveNumber(argv[++index], arg);
      continue;
    }
    if (arg === "--max-diff") {
      maxDiffPercent = positiveNumber(argv[++index], arg);
      continue;
    }
    if (arg === "--assets" || arg === "--factorio" || arg === "--suite") {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a path`);
      const resolved = path.resolve(REPO_ROOT, value);
      if (arg === "--assets") assetsDir = resolved;
      else if (arg === "--factorio") factorioBin = resolved;
      else suiteDir = resolved;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }
  if (pageIds.length > 0) selection = { kind: "ids", pageIds };
  if (!audit && !capture && !compare) audit = true;
  return {
    audit,
    capture,
    compare,
    selection,
    pixelsPerTile,
    batchSize,
    pixelThreshold,
    maxDiffPercent,
    assetsDir,
    factorioBin,
    suiteDir,
  };
}

async function exists(filename: string): Promise<boolean> {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function audit(opts: CliOptions): Promise<void> {
  const suite = await loadVisualSuite(opts.suiteDir);
  const pages = selectVisualPages(suite, opts.selection);
  const problems: string[] = [];
  console.log(
    `visual-suite audit: ${suite.manifest.suiteId} — ${pages.length}/${suite.manifest.pages.length} pages selected`,
  );

  try {
    const version = await inspectFactorioVersion(opts.factorioBin);
    if (version !== suite.manifest.gameVersion) {
      problems.push(`Factorio runtime ${version}; exact ${suite.manifest.gameVersion} required`);
    } else {
      console.log(`  runtime: Factorio ${version} ✓`);
    }
  } catch (error) {
    problems.push(`Factorio runtime: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const profile = await readAssetProfile(opts.assetsDir);
    const exact =
      profile.gameVersion === suite.manifest.gameVersion &&
      profile.mods.length === suite.manifest.requiredMods.length &&
      profile.mods.every((mod, index) => mod === suite.manifest.requiredMods[index]);
    if (!exact) {
      problems.push(
        `asset profile ${profile.gameVersion} [${profile.mods.join(", ")}]; ` +
          `${suite.manifest.gameVersion} [${suite.manifest.requiredMods.join(", ")}] required`,
      );
    } else {
      console.log(`  assets: ${profile.dir} ✓`);
    }
  } catch (error) {
    problems.push(`asset profile: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!opts.capture) {
    try {
      const index = await readReferenceIndex(suite, opts.pixelsPerTile);
      assertReferenceIndexProfile(suite, index, opts.pixelsPerTile);
      for (const page of pages) {
        const entry = assertReferenceFresh(suite, page, index);
        const file = path.join(
          REPO_ROOT,
          "fixtures/ground-truth",
          suite.manifest.suiteId,
          `ppt-${opts.pixelsPerTile}`,
          entry.file,
        );
        if (!(await exists(file))) problems.push(`missing reference PNG: ${page.page.id}`);
      }
      if (!problems.some((problem) => problem.includes("reference"))) {
        console.log(`  references: ${pages.length} fresh page(s) ✓`);
      }
    } catch (error) {
      problems.push(`references: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Visual-suite audit blocked:\n- ${problems.join("\n- ")}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.audit) await audit(opts);
  if (!opts.capture && !opts.compare) return;

  const suite = await loadVisualSuite(opts.suiteDir);
  const pages = selectVisualPages(suite, opts.selection);
  console.log(
    `visual-suite: ${suite.manifest.suiteId}, ${pages.length}/${suite.manifest.pages.length} pages, ` +
      `${pages.reduce((sum, page) => sum + page.cells.length, 0)} cells`,
  );
  if (opts.capture) {
    await captureVisualPages(suite, pages, {
      pixelsPerTile: opts.pixelsPerTile,
      assetsDir: opts.assetsDir,
      batchSize: opts.batchSize,
      factorioBin: opts.factorioBin,
    });
  }
  if (opts.compare) {
    const report = await compareVisualPages(suite, pages, {
      pixelsPerTile: opts.pixelsPerTile,
      assetsDir: opts.assetsDir,
      pixelThreshold: opts.pixelThreshold,
      maxDiffPercent: opts.maxDiffPercent,
    });
    console.log(
      `visual-suite: ${report.passed ? "PASS" : "FAIL"} — ` +
        `${report.failedCellCount}/${report.cellCount} failed cells on ` +
        `${report.failedPageCount}/${report.pageCount} pages`,
    );
    if (!report.passed) {
      throw new Error("Visual-suite comparison exceeded the configured per-cell diff threshold");
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
