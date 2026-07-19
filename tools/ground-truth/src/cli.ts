import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";
import { shootBlueprint } from "./shoot.js";

type CliArgs = {
  input: string;
  name: string;
  pixelsPerTile: number;
  showEntityInfo: boolean;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  pnpm -F @fpsr/ground-truth run shoot -- <bp-file-or--> [--name out] [--alt] [--ppt 64]
  pnpm ground-truth:refresh

Arguments:
  <bp-file-or-->   Path to a blueprint exchange-string file, or "-" for stdin
  --name <out>     Output basename (default: input filename without extension; required for stdin)
  --alt            Show entity info / alt-mode in the screenshot
  --ppt <n>        Match fpsr pixelsPerTile (default: 64). Sets Factorio zoom = ppt/32.
  --zoom <n>       Alias for --ppt with ppt = zoom*32 (legacy)

Camera size/position comes from fpsr planDrawList bounds (same as golden renders).

Commands:
  shoot     Capture one blueprint → fixtures/ground-truth/<name>.game.png
  refresh   Clear *.game.png, then shoot every golden case (visual-test canaries)

Quit any running Factorio instance first (user-data lock). Requires assets-out for framing.
`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let input: string | undefined;
  let name: string | undefined;
  let pixelsPerTile = 64;
  let showEntityInfo = false;

  while (args.length > 0) {
    const a = args.shift();
    if (a === undefined) break;
    if (a === "--") continue;
    if (a === "--help" || a === "-h") usage(0);
    if (a === "--alt") {
      showEntityInfo = true;
      continue;
    }
    if (a === "--name") {
      name = args.shift();
      if (!name) usage();
      continue;
    }
    if (a === "--ppt") {
      const raw = args.shift();
      if (!raw) usage();
      pixelsPerTile = Number(raw);
      if (!Number.isFinite(pixelsPerTile) || pixelsPerTile <= 0) {
        console.error(`Invalid --ppt: ${raw}`);
        usage();
      }
      continue;
    }
    if (a === "--zoom") {
      const raw = args.shift();
      if (!raw) usage();
      const zoom = Number(raw);
      if (!Number.isFinite(zoom) || zoom <= 0) {
        console.error(`Invalid --zoom: ${raw}`);
        usage();
      }
      pixelsPerTile = zoom * 32;
      continue;
    }
    if (a.startsWith("-") && a !== "-") {
      console.error(`Unknown flag: ${a}`);
      usage();
    }
    if (input !== undefined) {
      console.error(`Unexpected argument: ${a}`);
      usage();
    }
    input = a;
  }

  if (!input) usage();

  if (!name) {
    if (input === "-") {
      console.error("--name is required when reading blueprint from stdin");
      usage();
    }
    name = path.basename(input, path.extname(input));
  }

  name = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!name) {
    console.error("Empty --name after sanitization");
    process.exit(1);
  }

  return { input, name, pixelsPerTile, showEntityInfo };
}

async function resolveInputPath(input: string): Promise<string> {
  if (path.isAbsolute(input)) return input;
  const fromCwd = path.resolve(process.cwd(), input);
  try {
    await access(fromCwd);
    return fromCwd;
  } catch {
    return path.resolve(REPO_ROOT, input);
  }
}

async function readBlueprint(input: string): Promise<string> {
  if (input === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  const resolved = await resolveInputPath(input);
  return (await readFile(resolved, "utf8")).trim();
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  console.log(`ground-truth: reading blueprint from ${cli.input}`);
  const blueprint = await readBlueprint(cli.input);
  await shootBlueprint({
    blueprint,
    name: cli.name,
    pixelsPerTile: cli.pixelsPerTile,
    showEntityInfo: cli.showEntityInfo,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
