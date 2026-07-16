import { readFile } from "node:fs/promises";
import path from "node:path";
import { decode } from "fpsr";
import { describe, expect, it } from "vite-plus/test";
import { assertExactProfile, parseFactorioVersion } from "../src/profile.js";
import { cleanupMods, stageJobs } from "../src/stage.js";
import {
  assertReferenceFresh,
  loadVisualSuite,
  selectVisualPages,
  type ReferenceIndex,
} from "../src/visual-suite.js";

describe("manifest-driven visual suite", () => {
  it("extracts five deterministic canary leaves as bare blueprints", async () => {
    const suite = await loadVisualSuite();
    const pages = selectVisualPages(suite, { kind: "canary" });
    expect(pages).toHaveLength(5);
    expect(new Set(pages.map((page) => page.page.id)).size).toBe(5);

    const cells = pages.flatMap((page) => page.cells);
    expect(cells.some((cell) => cell.pose?.axis === "direction")).toBe(true);
    expect(cells.some((cell) => cell.pose?.axis === "orientation")).toBe(true);
    expect(cells.some((cell) => cell.caseKind === "adjacency-mask")).toBe(true);
    expect(cells.some((cell) => cell.caseKind === "belt-neighborhood")).toBe(true);
    expect(cells.some((cell) => cell.caseKind === "tile-patch")).toBe(true);

    for (const page of pages) {
      const extracted = decode(page.blueprintString);
      expect(extracted.blueprint).toBeDefined();
      expect(extracted.blueprint_book).toBeUndefined();
      expect(extracted.blueprint?.label).toBe(page.page.label);
      expect(page.captureName).not.toContain("/");
    }
  });

  it("fails stale page references by blueprint hash", async () => {
    const suite = await loadVisualSuite();
    const [page] = selectVisualPages(suite, { kind: "canary" });
    if (!page) throw new Error("missing canary page");
    const index: ReferenceIndex = {
      schema: 1,
      suiteId: suite.manifest.suiteId,
      gameVersion: suite.manifest.gameVersion,
      mods: [...suite.manifest.requiredMods],
      pixelsPerTile: 64,
      bookSha256: suite.bookSha256,
      manifestSha256: suite.manifestSha256,
      pages: {
        [page.page.id]: {
          pageId: page.page.id,
          pagePath: page.page.path,
          captureName: page.captureName,
          file: `${page.captureName}.game.png`,
          blueprintSha256: "stale",
          pngSha256: "unused",
          view: { minX: 0, minY: 0, maxX: 1, maxY: 1, zoom: 2 },
        },
      },
    };
    expect(() => assertReferenceFresh(suite, page, index)).toThrow(/Stale game reference/);
  });
});

describe("exact capture profiles", () => {
  it("parses Factorio version output and rejects a mislabeled profile", () => {
    expect(
      parseFactorioVersion(
        "Version: 2.1.11 (build 86962, mac-arm64, full)\nVersion: 64\nMap input version: 1.0.0-0\n",
      ),
    ).toBe("2.1.11");
    expect(() =>
      assertExactProfile(
        { gameVersion: "2.1.11", mods: ["base", "space-age"] },
        { gameVersion: "2.1.11", mods: ["base"] },
      ),
    ).toThrow(/profile mismatch/i);
  });

  it("stages an isolated Base-only mod list", async () => {
    const staged = await stageJobs({
      enabledMods: ["base"],
      jobs: [{ name: "base-only-test", blueprint: "0test" }],
    });
    try {
      const modList = JSON.parse(
        await readFile(path.join(staged.modDir, "mod-list.json"), "utf8"),
      ) as { mods: { name: string; enabled: boolean }[] };
      expect(modList.mods).toEqual([
        { name: "base", enabled: true },
        { name: "elevated-rails", enabled: false },
        { name: "quality", enabled: false },
        { name: "recycler", enabled: false },
        { name: "space-age", enabled: false },
        { name: "fpsr-rig", enabled: true },
      ]);
    } finally {
      await cleanupMods(staged.modDir);
    }
  });
});
