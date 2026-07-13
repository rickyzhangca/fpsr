/**
 * Clear fixtures/ground-truth/*.game.png and re-shoot every golden case
 * (viewer built-in samples / fixtures/golden/cases.json) in one Factorio launch.
 *
 * Camera framing comes from fpsr planDrawList bounds (same as golden renders).
 * Quit any running Factorio instance first (user-data lock).
 */
import { access, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { GROUND_TRUTH_OUT, REPO_ROOT } from "./paths.js";
import { shootJobs } from "./shoot.js";

type GoldenCase = {
  name: string;
  bp: string;
  ppt?: number;
  alt?: boolean;
};

const CASES_PATH = path.join(REPO_ROOT, "fixtures/golden/cases.json");
const GOLDEN_DIR = path.join(REPO_ROOT, "fixtures/golden");

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

async function loadCases(): Promise<GoldenCase[]> {
  const raw = JSON.parse(await readFile(CASES_PATH, "utf8")) as GoldenCase[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`No cases in ${CASES_PATH}`);
  }
  return raw;
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
    const ppt = c.ppt ?? 64;
    const list = byPpt.get(ppt) ?? [];
    list.push(c);
    byPpt.set(ppt, list);
  }

  let written = 0;
  for (const [ppt, group] of byPpt) {
    const jobs = [];
    for (const c of group) {
      const bpPath = path.join(GOLDEN_DIR, c.bp);
      await access(bpPath);
      jobs.push({
        name: c.name,
        blueprint: (await readFile(bpPath, "utf8")).trim(),
        showEntityInfo: c.alt ?? false,
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
