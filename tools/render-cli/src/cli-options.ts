import { readFile } from "node:fs/promises";
import path from "node:path";
import { stdin } from "node:process";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const DEFAULT_ASSETS = path.join(REPO_ROOT, "assets-out/2.1.11");

export interface CliOptions {
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

export function usage(): string {
  return [
    "Usage: pnpm -F @fpsr/render-cli render -- <bp-file-or--> [options]",
    "",
    "Options:",
    "  --out <path>     Output PNG path (default: out.png)",
    "  --ppt <number>   Pixels per tile (default: 64)",
    "  --path <i,j,...> Blueprint book path (comma-separated indices)",
    "  --alt            Enable alt-mode rendering (on by default; kept for compatibility)",
    "  --assets <dir>   Asset directory (default: assets-out/2.1.11 from repo root)",
    "  --profile        Collect decode + render stage timings",
    "  --warmup         With --profile: run once cold, then again warm (report both)",
    "  --json           Print machine-readable JSON (agents: use with --profile)",
    "",
    "Read blueprint string from a file or '-' for stdin.",
  ].join("\n");
}

export function invocationCwd(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function resolvePath(value: string, cwd: string): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

export function parseArgs(argv: string[], cwd = invocationCwd()): CliOptions {
  const opts: CliOptions = {
    out: path.resolve(cwd, "out.png"),
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
      const value = rest.shift();
      if (!value) throw new Error("--out requires a path");
      opts.out = resolvePath(value, cwd);
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
      const value = rest.shift();
      if (!value) throw new Error("--assets requires a directory path");
      opts.assets = resolvePath(value, cwd);
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
    if (arg !== "-" && arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
    if (opts.input) {
      throw new Error(`Unexpected extra argument: ${arg}\n\n${usage()}`);
    }
    opts.input = arg === "-" ? arg : resolvePath(arg, cwd);
  }

  return opts;
}

export async function readBlueprintInput(inputPath: string): Promise<string> {
  if (inputPath === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return (await readFile(inputPath, "utf8")).trim();
}
