#!/usr/bin/env tsx

import {
  type CanvasLike,
  type DecodeStats,
  type RenderProfile,
  createRenderer,
  decodeWithStats,
} from "fpsr";
import { writeFile } from "node:fs/promises";
import { Canvas } from "skia-canvas";
import { assertAssetsDir, localAssets } from "./assets.js";
import { parseArgs, readBlueprintInput, usage } from "./cli-options.js";

interface ProfileRun {
  label: "cold" | "warm" | "render";
  profile: RenderProfile;
}

interface ProfileReport {
  decode: DecodeStats;
  runs: ProfileRun[];
  output: {
    png: string;
    width: number;
    height: number;
    commandCount: number;
    pixelsPerTile: number;
  };
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const abs = Math.abs(ms);
  if (abs < 0.005) return "0ms";
  if (abs < 1) return `${abs.toFixed(2)}ms`;
  if (abs < 10) return `${abs.toFixed(2)}ms`;
  if (abs < 100) return `${abs.toFixed(1)}ms`;
  return `${Math.round(abs)}ms`;
}

function formatProfileText(report: ProfileReport): string {
  const lines: string[] = [];
  const { decode } = report;

  lines.push("DECODE");
  lines.push(
    `  mode=${decode.mode}  chars=${decode.inputChars}  json=${decode.jsonChars}  total=${fmtMs(decode.timings.totalMs)}`,
  );
  if (decode.compressedBytes != null && decode.inflatedBytes != null) {
    lines.push(
      `  compressed=${decode.compressedBytes}B  inflated=${decode.inflatedBytes}B  ratio=${decode.compressionRatio?.toFixed(1) ?? "—"}x`,
    );
  }
  lines.push("");

  for (const run of report.runs) {
    const p = run.profile;
    lines.push(`RENDER (${run.label.toUpperCase()}${p.cold ? ", cold assets" : ", warm assets"})`);
    lines.push(
      `  total=${fmtMs(p.totalMs)}  plan=${fmtMs(p.plan.totalMs)}  assets=${fmtMs(p.assetsMs)}  paint=${fmtMs(p.paintMs)}  icons=${fmtMs(p.iconBakeMs)}`,
    );
    lines.push(
      `  plan phases: migrate=${fmtMs(p.plan.migrateMs)} resolve=${fmtMs(p.plan.resolveMs)} tiles=${fmtMs(p.plan.tilesMs)} entities=${fmtMs(p.plan.entitiesMs)} overlays=${fmtMs(p.plan.overlaysMs)} sort=${fmtMs(p.plan.sortMs)}`,
    );
    lines.push(
      `  commands=${p.drawList.commandCount}  frames=${p.drawList.uniqueFrames}  atlases=${p.drawList.atlasIndices.length}/${p.db.atlasCount}  canvas=${p.output.width}x${p.output.height} (${p.output.megapixels.toFixed(3)}MP)`,
    );
    lines.push(
      `  shadows: runs=${p.shadow.runs} tiles=${p.shadow.tiles} composited=${(p.shadow.compositedPixels / 1_000_000).toFixed(2)}MP scratch=${(p.shadow.peakScratchPixels / 1_000_000).toFixed(2)}MP`,
    );
    const kinds = Object.entries(p.drawList.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    if (kinds) lines.push(`  byKind: ${kinds}`);
    for (const ev of p.assets) {
      const tag = ev.cached ? "cache" : "fetch";
      lines.push(`  atlas ${ev.index ?? "?"} [${tag}] ${fmtMs(ev.totalMs)}`);
    }
    lines.push("");
  }

  lines.push("OUTPUT");
  lines.push(
    `  ${report.output.png}  ${report.output.width}x${report.output.height}  commands=${report.output.commandCount}  ppt=${report.output.pixelsPerTile}`,
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input) {
    throw new Error(`Missing blueprint input.\n\n${usage()}`);
  }
  if (opts.warmup && !opts.profile) {
    throw new Error("--warmup requires --profile");
  }

  const source = await readBlueprintInput(opts.input);
  if (!source) {
    throw new Error("Blueprint input is empty");
  }

  await assertAssetsDir(opts.assets);

  const { doc, stats: decodeStats } = decodeWithStats(source);
  const renderer = await createRenderer({
    assets: localAssets(opts.assets),
    createCanvas: (width, height) => new Canvas(width, height) as unknown as CanvasLike,
  });

  const renderOpts = {
    blueprintPath: opts.blueprintPath,
    pixelsPerTile: opts.ppt,
    altMode: opts.alt,
    background: null as null,
    profile: opts.profile,
  };

  const runs: ProfileRun[] = [];

  if (opts.profile && opts.warmup) {
    const cold = await renderer.render(doc, renderOpts);
    if (!cold.profile) throw new Error("Expected profile on cold render");
    runs.push({ label: "cold", profile: cold.profile });

    const warm = await renderer.render(doc, renderOpts);
    if (!warm.profile) throw new Error("Expected profile on warm render");
    runs.push({ label: "warm", profile: warm.profile });

    const png = await warm.toPngBuffer();
    const outPath = opts.out;
    await writeFile(outPath, png);

    const report: ProfileReport = {
      decode: decodeStats,
      runs,
      output: {
        png: outPath,
        width: warm.width,
        height: warm.height,
        commandCount: warm.drawList.commands.length,
        pixelsPerTile: opts.ppt,
      },
    };

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatProfileText(report));
    }
    return;
  }

  const result = await renderer.render(doc, renderOpts);
  const png = await result.toPngBuffer();
  const outPath = opts.out;
  await writeFile(outPath, png);

  if (opts.profile) {
    if (!result.profile) throw new Error("Expected profile on render");
    const report: ProfileReport = {
      decode: decodeStats,
      runs: [
        {
          label: result.profile.cold ? "cold" : "render",
          profile: result.profile,
        },
      ],
      output: {
        png: outPath,
        width: result.width,
        height: result.height,
        commandCount: result.drawList.commands.length,
        pixelsPerTile: opts.ppt,
      },
    };
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatProfileText(report));
    }
    return;
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          png: outPath,
          width: result.width,
          height: result.height,
          commandCount: result.drawList.commands.length,
          pixelsPerTile: opts.ppt,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    [
      `Wrote ${outPath}`,
      `Dimensions: ${result.width}x${result.height}`,
      `Draw commands: ${result.drawList.commands.length}`,
    ].join("\n"),
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
