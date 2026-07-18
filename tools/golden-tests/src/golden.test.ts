import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { assetsAvailable } from "./assets.js";
import { goldenPngPath, loadCases } from "./cases.js";
import { comparePngPixels, compareToGolden } from "./compare.js";
import { ASSETS_DIR } from "./paths.js";
import { renderCase, renderTiledCase } from "./render-case.js";

const cases = loadCases();

function assetsReadySync(): boolean {
  try {
    const manifest = JSON.parse(readFileSync(path.join(ASSETS_DIR, "manifest.json"), "utf8")) as {
      schema?: unknown;
      tiers?: { "2x"?: { renderDb?: { file?: unknown } } };
    };
    const renderDbFile = manifest.tiers?.["2x"]?.renderDb?.file;
    return (
      manifest.schema === 2 &&
      typeof renderDbFile === "string" &&
      existsSync(path.join(ASSETS_DIR, renderDbFile))
    );
  } catch {
    return false;
  }
}

describe("golden PNG regression", () => {
  const hasAssets = assetsReadySync();

  for (const c of cases) {
    const hasGolden = existsSync(goldenPngPath(c));
    const skipReason = !hasAssets
      ? "assets-out/2.1.11 missing"
      : !hasGolden
        ? `${c.name}.png missing`
        : null;

    it.skipIf(skipReason !== null)(
      `matches golden: ${c.name}${skipReason ? ` (skip: ${skipReason})` : ""}`,
      async () => {
        const actual = await renderCase(c, ASSETS_DIR);
        const golden = await readFile(goldenPngPath(c));
        const result = await compareToGolden(c, actual, golden);

        expect(result.diffPercent).toBeLessThanOrEqual(0.1);
        expect(await assetsAvailable(ASSETS_DIR)).toBe(true);
      },
    );
  }

  const tiledCase = cases.find((c) => c.name === "smoke");
  it.skipIf(!hasAssets || !tiledCase || !existsSync(goldenPngPath(tiledCase)))(
    "matches the monolithic golden when rendered as small tiles",
    async () => {
      if (!tiledCase) throw new Error("smoke golden case is missing");
      const monolithic = await renderCase(tiledCase, ASSETS_DIR);
      const tiled = await renderTiledCase(tiledCase, ASSETS_DIR);
      const result = comparePngPixels(tiled, monolithic);
      expect(result.diffPercent).toBeLessThanOrEqual(0.01);
    },
  );

  for (const scenario of [
    {
      name: "checkerboard and coordinate overlays",
      options: { showCheckerboard: true, showCoordinates: true },
    },
    { name: "space backgrounds", options: { showSpace: true } },
  ] as const) {
    it.skipIf(!hasAssets || !tiledCase)(
      `has no visible tile seams for ${scenario.name}`,
      async () => {
        if (!tiledCase) throw new Error("smoke golden case is missing");
        const monolithic = await renderCase(tiledCase, ASSETS_DIR, scenario.options);
        const tiled = await renderTiledCase(tiledCase, ASSETS_DIR, scenario.options);
        const result = comparePngPixels(tiled, monolithic);
        expect(result.diffPercent).toBeLessThanOrEqual(0.01);
      },
    );
  }
});
