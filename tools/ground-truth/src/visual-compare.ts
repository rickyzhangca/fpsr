import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type CanvasLike, createRenderer } from "@rickyzhangca/fpsr";
import { localAssets } from "@rickyzhangca/fpsr/node";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { Canvas } from "skia-canvas";
import { REPO_ROOT } from "./paths.js";
import { assertAssetProfile } from "./profile.js";
import {
  type LoadedVisualSuite,
  type SelectedVisualPage,
  assertReferenceIndexProfile,
  assertReferenceFresh,
  readReferenceIndex,
  referenceDir,
} from "./visual-suite.js";

export interface CellComparison {
  id: string;
  cropPixels: { left: number; top: number; right: number; bottom: number };
  width: number;
  height: number;
  diffPixels: number;
  diffPercent: number;
  passed: boolean;
}

export interface PageComparison {
  id: string;
  file: string;
  width: number;
  height: number;
  checkerPhase: 0 | 1;
  inferredBackgrounds: [string, string];
  diffPixels: number;
  diffPercent: number;
  passed: boolean;
  cells: CellComparison[];
}

export interface VisualComparisonReport {
  schema: 1;
  suiteId: string;
  gameVersion: string;
  mods: string[];
  pixelsPerTile: number;
  pixelThreshold: number;
  maxDiffPercent: number;
  passed: boolean;
  pageCount: number;
  cellCount: number;
  failedPageCount: number;
  failedCellCount: number;
  pages: PageComparison[];
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "--");
}

function colorKey(color: Rgba): string {
  return `${color.r},${color.g},${color.b},${color.a}`;
}

function inferBackgrounds(expected: PNG): [Rgba, Rgba] {
  const counts = new Map<string, { color: Rgba; count: number }>();
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    const color: Rgba = {
      r: expected.data[offset]!,
      g: expected.data[offset + 1]!,
      b: expected.data[offset + 2]!,
      a: expected.data[offset + 3]!,
    };
    if (color.a !== 255) continue;
    const key = colorKey(color);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { color, count: 1 });
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 2);
  if (!top[0] || !top[1]) {
    throw new Error("Cannot infer the two lab checkerboard colors from game reference");
  }
  return [top[0].color, top[1].color];
}

function compositeOnChecker(
  transparent: PNG,
  colors: [Rgba, Rgba],
  pixelsPerTile: number,
  minX: number,
  minY: number,
  phase: 0 | 1,
): PNG {
  const result = new PNG({ width: transparent.width, height: transparent.height });
  for (let y = 0; y < transparent.height; y++) {
    const tileY = Math.floor(y / pixelsPerTile) + minY;
    for (let x = 0; x < transparent.width; x++) {
      const tileX = Math.floor(x / pixelsPerTile) + minX;
      const background = colors[(Math.abs(tileX + tileY + phase) % 2) as 0 | 1];
      const offset = (y * transparent.width + x) * 4;
      const alpha = transparent.data[offset + 3]! / 255;
      result.data[offset] = Math.round(
        transparent.data[offset]! * alpha + background.r * (1 - alpha),
      );
      result.data[offset + 1] = Math.round(
        transparent.data[offset + 1]! * alpha + background.g * (1 - alpha),
      );
      result.data[offset + 2] = Math.round(
        transparent.data[offset + 2]! * alpha + background.b * (1 - alpha),
      );
      result.data[offset + 3] = 255;
    }
  }
  return result;
}

function diffPng(
  expected: PNG,
  actual: PNG,
  pixelThreshold: number,
): { image: PNG; pixels: number; percent: number } {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `Dimension mismatch: game ${expected.width}x${expected.height}, renderer ${actual.width}x${actual.height}`,
    );
  }
  const image = new PNG({ width: expected.width, height: expected.height });
  const pixels = pixelmatch(
    expected.data,
    actual.data,
    image.data,
    expected.width,
    expected.height,
    { threshold: pixelThreshold },
  );
  return {
    image,
    pixels,
    percent: (pixels / (expected.width * expected.height)) * 100,
  };
}

function crop(source: PNG, box: CellComparison["cropPixels"]): PNG {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const result = new PNG({ width, height });
  PNG.bitblt(source, result, box.left, box.top, width, height, 0, 0);
  return result;
}

function cellCropPixels(
  page: SelectedVisualPage,
  cellId: string,
  frame: { minX: number; minY: number },
  pixelsPerTile: number,
  width: number,
  height: number,
): CellComparison["cropPixels"] {
  const cell = page.cells.find((entry) => entry.id === cellId);
  if (!cell) throw new Error(`Missing cell ${cellId} on page ${page.page.id}`);
  const left = Math.max(0, Math.floor((cell.cropTiles.left - frame.minX) * pixelsPerTile));
  const top = Math.max(0, Math.floor((cell.cropTiles.top - frame.minY) * pixelsPerTile));
  const right = Math.min(width, Math.ceil((cell.cropTiles.right - frame.minX) * pixelsPerTile));
  const bottom = Math.min(height, Math.ceil((cell.cropTiles.bottom - frame.minY) * pixelsPerTile));
  if (right <= left || bottom <= top) {
    throw new Error(`Cell ${cellId} has an empty crop in page frame`);
  }
  return { left, top, right, bottom };
}

export async function compareVisualPages(
  suite: LoadedVisualSuite,
  pages: SelectedVisualPage[],
  options: {
    pixelsPerTile: number;
    assetsDir: string;
    pixelThreshold?: number;
    maxDiffPercent?: number;
    artifactsDir?: string;
  },
): Promise<VisualComparisonReport> {
  const pixelThreshold = options.pixelThreshold ?? 0.1;
  const maxDiffPercent = options.maxDiffPercent ?? 0.1;
  await assertAssetProfile(options.assetsDir, {
    gameVersion: suite.manifest.gameVersion,
    mods: suite.manifest.requiredMods,
  });
  const index = await readReferenceIndex(suite, options.pixelsPerTile);
  assertReferenceIndexProfile(suite, index, options.pixelsPerTile);
  const artifactsDir =
    options.artifactsDir ??
    path.join(
      REPO_ROOT,
      "build/visual-tests",
      suite.manifest.suiteId,
      `ppt-${options.pixelsPerTile}`,
    );
  await mkdir(artifactsDir, { recursive: true });

  const renderer = await createRenderer({
    assets: localAssets(options.assetsDir),
    createCanvas: (width, height) => new Canvas(width, height) as unknown as CanvasLike,
  });
  const pageReports: PageComparison[] = [];

  for (const page of pages) {
    const reference = assertReferenceFresh(suite, page, index);
    const referenceBytes = await readFile(
      path.join(referenceDir(suite, options.pixelsPerTile), reference.file),
    );
    if (sha256(referenceBytes) !== reference.pngSha256) {
      throw new Error(`Game reference checksum mismatch for page ${page.page.id}`);
    }
    const expected = PNG.sync.read(referenceBytes);
    const rendered = await renderer.render(page.blueprint, {
      pixelsPerTile: options.pixelsPerTile,
      altMode: false,
      background: { type: "none" },
    });
    const transparent = PNG.sync.read(Buffer.from(await rendered.toPngBuffer()));
    const view = reference.view;
    const sameFrame =
      rendered.tileFrame.minX === view.minX &&
      rendered.tileFrame.minY === view.minY &&
      rendered.tileFrame.maxX === view.maxX &&
      rendered.tileFrame.maxY === view.maxY;
    if (!sameFrame) {
      throw new Error(
        `Stale frame for ${page.page.id}: reference ` +
          `${view.minX},${view.minY}..${view.maxX},${view.maxY}; renderer ` +
          `${rendered.tileFrame.minX},${rendered.tileFrame.minY}..${rendered.tileFrame.maxX},${rendered.tileFrame.maxY}`,
      );
    }
    if (expected.width !== transparent.width || expected.height !== transparent.height) {
      throw new Error(
        `Dimension mismatch for ${page.page.id}: game ${expected.width}x${expected.height}, ` +
          `renderer ${transparent.width}x${transparent.height}`,
      );
    }

    const backgrounds = inferBackgrounds(expected);
    const candidateForPhase = (phase: 0 | 1) => {
      const actual = compositeOnChecker(
        transparent,
        backgrounds,
        options.pixelsPerTile,
        rendered.tileFrame.minX,
        rendered.tileFrame.minY,
        phase,
      );
      return { phase, actual, diff: diffPng(expected, actual, pixelThreshold) };
    };
    const candidates = [candidateForPhase(0), candidateForPhase(1)] as const;
    const selected =
      candidates[0].diff.pixels <= candidates[1].diff.pixels ? candidates[0] : candidates[1];

    const cells: CellComparison[] = [];
    for (const cell of page.cells) {
      const cropPixels = cellCropPixels(
        page,
        cell.id,
        rendered.tileFrame,
        options.pixelsPerTile,
        expected.width,
        expected.height,
      );
      const expectedCell = crop(expected, cropPixels);
      const actualCell = crop(selected.actual, cropPixels);
      const diff = diffPng(expectedCell, actualCell, pixelThreshold);
      const passed = diff.percent <= maxDiffPercent;
      cells.push({
        id: cell.id,
        cropPixels,
        width: expectedCell.width,
        height: expectedCell.height,
        diffPixels: diff.pixels,
        diffPercent: diff.percent,
        passed,
      });
      if (!passed) {
        const stem = safeName(cell.id);
        await Promise.all([
          writeFile(path.join(artifactsDir, `${stem}.expected.png`), PNG.sync.write(expectedCell)),
          writeFile(path.join(artifactsDir, `${stem}.actual.png`), PNG.sync.write(actualCell)),
          writeFile(path.join(artifactsDir, `${stem}.diff.png`), PNG.sync.write(diff.image)),
        ]);
      }
    }

    const passed = cells.every((cell) => cell.passed);
    if (!passed) {
      const stem = safeName(page.page.id);
      await Promise.all([
        writeFile(path.join(artifactsDir, `${stem}.actual.png`), PNG.sync.write(selected.actual)),
        writeFile(path.join(artifactsDir, `${stem}.diff.png`), PNG.sync.write(selected.diff.image)),
      ]);
    }
    pageReports.push({
      id: page.page.id,
      file: reference.file,
      width: expected.width,
      height: expected.height,
      checkerPhase: selected.phase,
      inferredBackgrounds: [colorKey(backgrounds[0]), colorKey(backgrounds[1])],
      diffPixels: selected.diff.pixels,
      diffPercent: selected.diff.percent,
      passed,
      cells,
    });
  }

  const allCells = pageReports.flatMap((page) => page.cells);
  const report: VisualComparisonReport = {
    schema: 1,
    suiteId: suite.manifest.suiteId,
    gameVersion: suite.manifest.gameVersion,
    mods: [...suite.manifest.requiredMods],
    pixelsPerTile: options.pixelsPerTile,
    pixelThreshold,
    maxDiffPercent,
    passed: pageReports.every((page) => page.passed),
    pageCount: pageReports.length,
    cellCount: allCells.length,
    failedPageCount: pageReports.filter((page) => !page.passed).length,
    failedCellCount: allCells.filter((cell) => !cell.passed).length,
    pages: pageReports,
  };
  await writeFile(path.join(artifactsDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
