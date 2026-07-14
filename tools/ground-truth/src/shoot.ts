import { decode, selectBlueprint } from "fpsr";
import { formatShotView, planShotView } from "./frame.js";
import { copyToFixtures, launchAndCapture } from "./launch.js";
import { GROUND_TRUTH_OUT } from "./paths.js";
import { type CaptureJob, cleanupMods, stageJobs } from "./stage.js";

export type ShootOptions = {
  blueprint: string;
  name: string;
  /** fpsr pixelsPerTile; drives Factorio zoom (= ppt/32) and framing. Default 64. */
  pixelsPerTile?: number;
  showEntityInfo?: boolean;
  padTiles?: number;
  /**
   * When true (default), plan camera from fpsr draw-list bounds so the shot
   * matches the renderer canvas. Requires a built assets-out/<version>/ bundle.
   */
  useFpsrView?: boolean;
};

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!cleaned) throw new Error("Empty ground-truth name after sanitization");
  return cleaned;
}

function extractWires(blueprint: string): [number, number, number, number][] | undefined {
  try {
    const wires = selectBlueprint(decode(blueprint.trim())).wires;
    if (!wires?.length) return undefined;
    return wires.map((w) => [w[0], w[1], w[2], w[3]] as [number, number, number, number]);
  } catch {
    return undefined;
  }
}

async function withPlannedViews(
  jobs: CaptureJob[],
  opts: { pixelsPerTile: number; padTiles?: number; useFpsrView?: boolean },
): Promise<CaptureJob[]> {
  const out: CaptureJob[] = [];
  for (const job of jobs) {
    let next: CaptureJob = job;
    if (!next.wires) {
      const wires = extractWires(next.blueprint);
      if (wires) {
        console.log(`ground-truth: ${next.name} wires=${wires.length}`);
        next = { ...next, wires };
      }
    }
    if (opts.useFpsrView === false || next.view) {
      out.push(next);
      continue;
    }
    const ppt = next.zoom != null ? next.zoom * 32 : opts.pixelsPerTile;
    const view = await planShotView({
      blueprint: next.blueprint,
      pixelsPerTile: ppt,
      altMode: next.showEntityInfo,
      padTiles: opts.padTiles ?? 0,
    });
    console.log(`ground-truth: ${next.name} frame ${formatShotView(view)}`);
    out.push({ ...next, view });
  }
  return out;
}

/** Stage mods, launch Factorio once, copy all screenshots into fixtures/ground-truth/. */
export async function shootJobs(
  jobs: CaptureJob[],
  opts?: {
    pixelsPerTile?: number;
    padTiles?: number;
    useFpsrView?: boolean;
  },
): Promise<string[]> {
  if (jobs.length === 0) throw new Error("shootJobs requires at least one job");

  const pixelsPerTile = opts?.pixelsPerTile ?? 64;
  const normalized = jobs.map((job) => ({
    ...job,
    name: sanitizeName(job.name),
    blueprint: job.blueprint.trim(),
  }));
  for (const job of normalized) {
    if (!job.blueprint) throw new Error(`Blueprint string is empty for "${job.name}"`);
  }

  const planned = await withPlannedViews(normalized, {
    pixelsPerTile,
    padTiles: opts?.padTiles,
    useFpsrView: opts?.useFpsrView,
  });

  console.log(
    `ground-truth: ${planned.length} job(s) in one Factorio launch — ${planned.map((j) => j.name).join(", ")}`,
  );

  const staged = await stageJobs({
    zoom: pixelsPerTile / 32,
    jobs: planned,
  });
  console.log(`ground-truth: staged mods at ${staged.modDir}`);

  try {
    const { pngSources } = await launchAndCapture({
      modDir: staged.modDir,
      names: staged.names,
    });
    const dests: string[] = [];
    for (const name of staged.names) {
      const src = pngSources.get(name);
      if (!src) throw new Error(`Missing screenshot for ${name}`);
      dests.push(await copyToFixtures(src, name, GROUND_TRUTH_OUT));
    }
    console.log("ground-truth: done");
    return dests;
  } finally {
    await cleanupMods(staged.modDir);
    console.log(`ground-truth: cleaned ${staged.modDir}`);
  }
}

/** Capture a single blueprint (one-job Factorio launch). */
export async function shootBlueprint(opts: ShootOptions): Promise<string> {
  const ppt = opts.pixelsPerTile ?? 64;
  const [dest] = await shootJobs(
    [
      {
        name: opts.name,
        blueprint: opts.blueprint,
        showEntityInfo: opts.showEntityInfo,
      },
    ],
    {
      pixelsPerTile: ppt,
      padTiles: opts.padTiles,
      useFpsrView: opts.useFpsrView,
    },
  );
  if (!dest) throw new Error("shootBlueprint produced no output");
  return dest;
}
