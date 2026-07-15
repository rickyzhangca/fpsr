import { readdir } from "node:fs/promises";
import path from "node:path";
import { benchAssetUsage, formatAssetBench } from "./bench.js";
import { ASSETS_OUT, configurePipelinePaths, REPO_ROOT } from "./paths.js";
import { verifyAssetBundle } from "./verify.js";

type Command = "dump" | "distill" | "pack" | "all" | "verify" | "bench";

interface CliOptions {
  command: Command;
  force: boolean;
  factorioPath?: string;
  dir?: string;
  blueprint?: string;
}

function usage(): string {
  return [
    "Usage: pnpm -F @fpsr/pipeline run pipeline <command> [options]",
    "",
    "Commands:",
    "  all                 Dump, distill, pack, verify, and atomically publish assets",
    "  dump                Generate the game data dump",
    "  distill | pack      Distill and pack the existing dump",
    "  verify              Verify a generated schema-2 asset bundle",
    "  bench <blueprint>   Report atlas use for a blueprint string file",
    "",
    "Options:",
    "  --factorio <path>   Factorio app/root/executable (overrides FPSR_FACTORIO_PATH)",
    "  --dir <path>        Asset bundle for verify/bench",
    "  --force             Regenerate the game data dump",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  let command: Command | undefined;
  let force = false;
  let factorioPath: string | undefined;
  let dir: string | undefined;
  let blueprint: string | undefined;
  const commands = new Set<Command>(["dump", "distill", "pack", "all", "verify", "bench"]);

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg || arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--factorio" || arg === "--dir") {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a path`);
      if (arg === "--factorio") factorioPath = value;
      else dir = path.resolve(REPO_ROOT, value);
      continue;
    }
    if (!command && commands.has(arg as Command)) {
      command = arg as Command;
      continue;
    }
    if (command === "bench" && !blueprint) {
      blueprint = path.resolve(REPO_ROOT, arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  return { command: command ?? "all", force, factorioPath, dir, blueprint };
}

async function generatedAssetDir(
  explicit: string | undefined,
  factorioPath?: string,
): Promise<string> {
  if (explicit) return explicit;
  try {
    return configurePipelinePaths({ factorioPath }).versionOut;
  } catch {
    const entries = await readdir(ASSETS_OUT, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(ASSETS_OUT, entry.name))
      .sort();
    if (candidates.length === 1) return candidates[0]!;
    throw new Error("Cannot choose an asset bundle; pass --dir <assets-out/version>");
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "verify") {
    const dir = await generatedAssetDir(options.dir, options.factorioPath);
    const result = await verifyAssetBundle(dir);
    console.log(
      `verify: ${result.gameVersion} — ${result.frames} frames, ${result.atlases} atlases, ` +
        `${(result.decodedPixels / 1_000_000).toFixed(2)} MP, ${(result.bytes / 1024 / 1024).toFixed(2)} MiB`,
    );
    return;
  }

  if (options.command === "bench") {
    if (!options.blueprint) throw new Error(`bench requires a blueprint file\n\n${usage()}`);
    const dir = await generatedAssetDir(options.dir, options.factorioPath);
    const reports = await Promise.all([
      benchAssetUsage(options.blueprint, dir, "1x"),
      benchAssetUsage(options.blueprint, dir, "2x"),
    ]);
    console.log(reports.map(formatAssetBench).join("\n\n"));
    return;
  }

  const paths = configurePipelinePaths({ factorioPath: options.factorioPath });
  console.log(`pipeline: Factorio ${paths.install.version} at ${paths.install.root}`);
  const { dumpData } = await import("./dump.js");
  const { distillAndPack } = await import("./distill.js");
  if (options.command === "dump" || options.command === "all") {
    await dumpData({ force: options.force });
  }
  if (options.command === "distill" || options.command === "pack" || options.command === "all") {
    await distillAndPack();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
