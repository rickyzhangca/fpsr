import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { GoldenCase } from "./cases.js";
import { DIFF_DIR } from "./paths.js";

const PIXEL_THRESHOLD = 0.1;
const MAX_DIFF_PERCENT = 0.1;

export interface CompareResult {
  diffPixels: number;
  diffPercent: number;
  width: number;
  height: number;
}

export function comparePngPixels(actual: Buffer, expected: Buffer): CompareResult {
  const left = PNG.sync.read(actual);
  const right = PNG.sync.read(expected);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `Dimension mismatch: ${left.width}x${left.height} vs ${right.width}x${right.height}`,
    );
  }
  const diff = new PNG({ width: left.width, height: left.height });
  const diffPixels = pixelmatch(left.data, right.data, diff.data, left.width, left.height, {
    threshold: PIXEL_THRESHOLD,
  });
  return {
    diffPixels,
    diffPercent: (diffPixels / (left.width * left.height)) * 100,
    width: left.width,
    height: left.height,
  };
}

export async function compareToGolden(
  c: GoldenCase,
  actual: Buffer,
  golden: Buffer,
): Promise<CompareResult> {
  const expected = PNG.sync.read(golden);
  const rendered = PNG.sync.read(actual);

  if (expected.width !== rendered.width || expected.height !== rendered.height) {
    throw new Error(
      `Dimension mismatch for "${c.name}": golden ${expected.width}x${expected.height}, actual ${rendered.width}x${rendered.height}`,
    );
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  const diffPixels = pixelmatch(
    expected.data,
    rendered.data,
    diff.data,
    expected.width,
    expected.height,
    { threshold: PIXEL_THRESHOLD },
  );

  const totalPixels = expected.width * expected.height;
  const diffPercent = (diffPixels / totalPixels) * 100;

  if (diffPercent > MAX_DIFF_PERCENT) {
    await mkdir(DIFF_DIR, { recursive: true });
    await writeFile(path.join(DIFF_DIR, `${c.name}.actual.png`), actual);
    await writeFile(path.join(DIFF_DIR, `${c.name}.diff.png`), PNG.sync.write(diff));
    throw new Error(
      [
        `Golden mismatch for "${c.name}": ${diffPercent.toFixed(4)}% pixels differ (max ${MAX_DIFF_PERCENT}%).`,
        `Wrote fixtures/golden/__diff__/${c.name}.actual.png`,
        `Wrote fixtures/golden/__diff__/${c.name}.diff.png`,
        "Run `pnpm -F @fpsr/golden-tests run update` to refresh goldens after intentional changes.",
      ].join("\n"),
    );
  }

  return {
    diffPixels,
    diffPercent,
    width: expected.width,
    height: expected.height,
  };
}
