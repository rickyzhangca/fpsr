#!/usr/bin/env tsx

import {
  type CanvasLike,
  type DecodeStats,
  type RenderProfile,
  createRenderer,
  decodeWithStats,
} from "fpsr";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stdin } from "node:process";
import { fileURLToPath } from "node:url";
import { Canvas } from "skia-canvas";
import { assertAssetsDir, localAssets } from "./assets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_ASSETS = path.join(REPO_ROOT, "assets-out/2.1.9");

interface CliOptions {
  input?: string;
  out: string;
  ppt: number;
  blueprintPath?: number[];
  alt?: boolean;
  assets: string;
  profile: boolean;
  json: boolean;
  warmup: boolean;
}

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

function usage(): string {
  return [
    "Usage: pnpm -F @fpsr/render-cli render -- <bp-file-or--> [options]",
    "",
    "Options:",
    "  --out <path>     Output PNG path (default: out.png)",
    "  --ppt <number>   Pixels per tile (default: 64)",
    "  --path <i,j,...> Blueprint book path (comma-separated indices)",
    "  --alt            Enable alt-mode rendering (on by default; kept for compatibility)",
    "  --assets <dir>   Asset directory (default: assets-out/2.1.9 from repo root)",
    "  --profile        Collect decode + render stage timings",
    "  --warmup         With --profile: run once cold, then again warm (report both)",
    "  --json           Print machine-readable JSON (agents: use with --profile)",
    "",
    "Read blueprint string from a file or '-' for stdin.",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    out: "out.png",
    ppt: 64,
    assets: DEFAULT_ASSETS,
    profile: false,
    json: false,
    warmup: false,
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    if (!arg || arg === "--") continue;

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--out") {
      opts.out = rest.shift() ?? opts.out;
      continue;
    }
    if (arg === "--ppt") {
      const raw = rest.shift();
      if (!raw) throw new Error("--ppt requires a number");
      opts.ppt = Number(raw);
      if (!Number.isFinite(opts.ppt) || opts.ppt <= 0) {
        throw new Error(`Invalid --ppt value: ${raw}`);
      }
      continue;
    }
    if (arg === "--path") {
      const raw = rest.shift();
      if (!raw) throw new Error("--path requires comma-separated indices");
      opts.blueprintPath = raw.split(",").map((part) => {
        const n = Number(part.trim());
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`Invalid path index: ${part}`);
        }
        return n;
      });
      continue;
    }
    if (arg === "--alt") {
      opts.alt = true;
      continue;
    }
    if (arg === "--assets") {
      const raw = rest.shift();
      if (!raw) throw new Error("--assets requires a directory path");
      opts.assets = path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
      continue;
    }
    if (arg === "--profile") {
      opts.profile = true;
      continue;
    }
    if (arg === "--json") {
      opts.json = true;
      continue;
    }
    if (arg === "--warmup") {
      opts.warmup = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
    if (opts.input) {
      throw new Error(`Unexpected extra argument: ${arg}\n\n${usage()}`);
    }
    opts.input = arg;
  }

  return opts;
}

async function readBlueprintInput(inputPath: string): Promise<string> {
  if (inputPath === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return (await readFile(inputPath, "utf8")).trim();
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

  const inputPath = opts.input === "-" ? "-" : path.resolve(opts.input);
  const source = await readBlueprintInput(inputPath);
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
    const outPath = path.resolve(opts.out);
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
  const outPath = path.resolve(opts.out);
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
