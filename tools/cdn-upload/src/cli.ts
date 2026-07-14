#!/usr/bin/env tsx

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_DIR = path.join(REPO_ROOT, "assets-out/2.1.9");

interface Manifest {
  schema: 2;
  gameVersion: string;
  renderDb: { file: string; sha256: string };
  atlases: { file: string; sha256: string }[];
}

interface UploadFile {
  relativePath: string;
  absolutePath: string;
  size: number;
}

interface CliOptions {
  dir: string;
  dryRun: boolean;
}

interface BunnyConfig {
  zone: string;
  host: string;
  apiKey: string;
}

function usage(): string {
  return [
    "Usage: pnpm -F @fpsr/cdn-upload run upload -- [--dir <assets-dir>] [--dry-run]",
    "",
    "Upload a pipeline asset directory to BunnyCDN Storage.",
    "Remote layout: /{gameVersion}/{filename} (gameVersion from manifest.json).",
    "",
    "Options:",
    "  --dir <path>   Asset directory (default: assets-out/2.1.9 from repo root)",
    "  --dry-run      List files and sizes without uploading",
    "",
    "Environment:",
    "  BUNNY_STORAGE_ZONE   Storage zone name (required unless --dry-run)",
    "  BUNNY_STORAGE_HOST   Storage host (default: storage.bunnycdn.com)",
    "  BUNNY_API_KEY        Storage API key (required unless --dry-run)",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dir: DEFAULT_DIR,
    dryRun: false,
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    if (!arg || arg === "--") continue;

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--dir") {
      const raw = rest.shift();
      if (!raw) throw new Error("--dir requires a path");
      opts.dir = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
      continue;
    }
    if (arg === "--dry-run") {
      opts.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return opts;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function contentTypeFor(filename: string): string {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function readBunnyConfig(dryRun: boolean): BunnyConfig | null {
  const zone = process.env.BUNNY_STORAGE_ZONE?.trim();
  const host = process.env.BUNNY_STORAGE_HOST?.trim() || "storage.bunnycdn.com";
  const apiKey = process.env.BUNNY_API_KEY?.trim();

  const missing: string[] = [];
  if (!zone) missing.push("BUNNY_STORAGE_ZONE");
  if (!apiKey) missing.push("BUNNY_API_KEY");

  if (!zone || !apiKey) {
    if (dryRun) return null;
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}\nSet them before uploading, or pass --dry-run to preview files only.`,
    );
  }

  return { zone, host, apiKey };
}

async function readManifest(dir: string): Promise<Manifest> {
  const manifestPath = path.join(dir, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`manifest.json not found in ${dir}`);
  }

  const manifest = JSON.parse(raw) as Manifest;
  if (manifest.schema !== 2) {
    throw new Error(`manifest.json in ${dir} is not schema 2`);
  }
  if (!manifest.gameVersion || typeof manifest.gameVersion !== "string") {
    throw new Error(`manifest.json in ${dir} is missing gameVersion`);
  }
  return manifest;
}

export async function collectFiles(dir: string): Promise<UploadFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: UploadFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = path.join(dir, entry.name);
    const info = await stat(absolutePath);
    files.push({
      relativePath: entry.name,
      absolutePath,
      size: info.size,
    });
  }

  files.sort((a, b) => {
    if (a.relativePath === "manifest.json") return 1;
    if (b.relativePath === "manifest.json") return -1;
    return a.relativePath.localeCompare(b.relativePath);
  });
  return files;
}

function remoteUrl(host: string, zone: string, version: string, filename: string): string {
  const encoded = filename.split("/").map(encodeURIComponent).join("/");
  return `https://${host}/${zone}/${version}/${encoded}`;
}

async function uploadFile(config: BunnyConfig, version: string, file: UploadFile): Promise<void> {
  const url = remoteUrl(config.host, config.zone, version, file.relativePath);
  const body = await readFile(file.absolutePath);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: config.apiKey,
      "Content-Type": contentTypeFor(file.relativePath),
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Upload failed for ${file.relativePath}: HTTP ${response.status} ${response.statusText}${detail ? `\n${detail}` : ""}`,
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const config = readBunnyConfig(opts.dryRun);
  const manifest = await readManifest(opts.dir);
  const files = await collectFiles(opts.dir);

  if (files.length === 0) {
    throw new Error(`No files found in ${opts.dir}`);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const mode = opts.dryRun ? "dry-run" : "upload";

  console.log(`@fpsr/cdn-upload (${mode})`);
  console.log(`  local:   ${opts.dir}`);
  console.log(`  version: ${manifest.gameVersion}`);
  if (config) {
    console.log(`  host:    ${config.host}`);
    console.log(`  zone:    ${config.zone}`);
  } else {
    console.log("  host:    (skipped — env not set)");
    console.log("  zone:    (skipped — env not set)");
  }
  console.log(`  files:   ${files.length} (${formatBytes(totalBytes)} total)`);
  console.log("");

  for (const [index, file] of files.entries()) {
    const prefix = `[${index + 1}/${files.length}]`;
    const remote = config
      ? remoteUrl(config.host, config.zone, manifest.gameVersion, file.relativePath)
      : `/${manifest.gameVersion}/${file.relativePath}`;

    if (opts.dryRun) {
      console.log(`${prefix} ${file.relativePath}  ${formatBytes(file.size)}  -> ${remote}`);
      continue;
    }

    if (!config) {
      throw new Error("BunnyCDN credentials are required for upload");
    }

    process.stdout.write(
      `${prefix} uploading ${file.relativePath} (${formatBytes(file.size)})... `,
    );
    await uploadFile(config, manifest.gameVersion, file);
    console.log("done");
  }

  if (opts.dryRun) {
    console.log("\nDry run complete — no files uploaded.");
  } else {
    console.log(`\nUploaded ${files.length} file(s) to /${manifest.gameVersion}/`);
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nError: ${message}`);
    process.exit(1);
  });
}
