#!/usr/bin/env tsx

import {
  type AssetManifestV2,
  verifyAssetBundle,
} from "@fpsr/pipeline";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_DIR = path.join(REPO_ROOT, "assets-out/2.1.11");
const DEFAULT_STORAGE_ZONE = "fpsr";
const DEFAULT_CONCURRENCY = 6;
const MAX_UPLOAD_ATTEMPTS = 4;

export interface UploadFile {
  relativePath: string;
  absolutePath: string;
  size: number;
}

interface CliOptions {
  dir: string;
  dryRun: boolean;
  concurrency: number;
}

export interface BunnyConfig {
  zone: string;
  host: string;
  apiKey: string;
}

function usage(): string {
  return [
    "Usage: pnpm -F @fpsr/cdn-upload run upload -- [--dir <assets-dir>] [--dry-run] [--concurrency <n>]",
    "",
    "Upload a pipeline asset directory to BunnyCDN Storage.",
    "Remote layout: /{gameVersion}/{filename} (gameVersion from manifest.json).",
    "",
    "Options:",
    "  --dir <path>   Asset directory (default: assets-out/2.1.11 from repo root)",
    "  --dry-run      List files and sizes without uploading",
    `  --concurrency  Parallel content uploads (default: ${DEFAULT_CONCURRENCY}, max: 16)`,
    "",
    "Environment:",
    `  BUNNY_STORAGE_ZONE   Storage zone name (default: ${DEFAULT_STORAGE_ZONE})`,
    "  BUNNY_STORAGE_HOST   Storage host (default: storage.bunnycdn.com)",
    "  BUNNY_STORAGE_PASSWORD  Storage zone password (required unless --dry-run)",
    "  BUNNY_API_KEY        Legacy alias for BUNNY_STORAGE_PASSWORD",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dir: DEFAULT_DIR,
    dryRun: false,
    concurrency: DEFAULT_CONCURRENCY,
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
      opts.dir = resolveAssetsDir(raw);
      continue;
    }
    if (arg === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (arg === "--concurrency") {
      const raw = rest.shift();
      const concurrency = Number(raw);
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
        throw new Error("--concurrency must be an integer between 1 and 16");
      }
      opts.concurrency = concurrency;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return opts;
}

export function resolveAssetsDir(raw: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function contentTypeFor(filename: string): string {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function readBunnyConfig(dryRun: boolean): BunnyConfig | null {
  const zone = process.env.BUNNY_STORAGE_ZONE?.trim() || DEFAULT_STORAGE_ZONE;
  const host = process.env.BUNNY_STORAGE_HOST?.trim() || "storage.bunnycdn.com";
  const apiKey =
    process.env.BUNNY_STORAGE_PASSWORD?.trim() || process.env.BUNNY_API_KEY?.trim();

  if (!apiKey) {
    if (dryRun) return null;
    throw new Error(
      "Missing BUNNY_STORAGE_PASSWORD (or legacy BUNNY_API_KEY).\n" +
        "Set the Storage Zone password before uploading, or pass --dry-run to preview files only.",
    );
  }

  return { zone, host, apiKey };
}

async function readManifest(dir: string): Promise<AssetManifestV2> {
  const manifestPath = path.join(dir, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`manifest.json not found in ${dir}`);
  }

  const manifest = JSON.parse(raw) as AssetManifestV2;
  if (manifest.schema !== 2 || !manifest.tiers?.["1x"] || !manifest.tiers?.["2x"]) {
    throw new Error(`manifest.json in ${dir} is not schema 2`);
  }
  if (!manifest.gameVersion || typeof manifest.gameVersion !== "string") {
    throw new Error(`manifest.json in ${dir} is missing gameVersion`);
  }
  return manifest;
}

function assertSafeFilename(filename: string): void {
  if (
    !filename ||
    path.isAbsolute(filename) ||
    filename !== path.basename(filename) ||
    filename === "." ||
    filename === ".."
  ) {
    throw new Error(`Unsafe asset filename in manifest: ${filename}`);
  }
}

export async function collectFiles(
  dir: string,
  manifest?: AssetManifestV2,
): Promise<UploadFile[]> {
  const resolvedManifest = manifest ?? (await readManifest(dir));
  const referenced = new Set<string>();
  for (const tier of ["1x", "2x"] as const) {
    const descriptor = resolvedManifest.tiers[tier];
    referenced.add(descriptor.renderDb.file);
    for (const atlas of descriptor.atlases) referenced.add(atlas.file);
  }

  const files: UploadFile[] = [];
  for (const relativePath of [...referenced, "manifest.json"]) {
    assertSafeFilename(relativePath);
    const absolutePath = path.join(dir, relativePath);
    const info = await stat(absolutePath).catch(() => null);
    if (!info?.isFile()) throw new Error(`Referenced asset not found: ${absolutePath}`);
    files.push({
      relativePath,
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

export function remoteUrl(host: string, zone: string, version: string, filename: string): string {
  const encoded = filename.split("/").map(encodeURIComponent).join("/");
  return `https://${host}/${zone}/${version}/${encoded}`;
}

type UploadRuntime = {
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
};

export async function uploadFile(
  config: BunnyConfig,
  version: string,
  file: UploadFile,
  runtime: UploadRuntime = {},
): Promise<void> {
  const url = remoteUrl(config.host, config.zone, version, file.relativePath);
  const body = await readFile(file.absolutePath);
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const wait = runtime.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = runtime.maxAttempts ?? MAX_UPLOAD_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "PUT",
        headers: {
          AccessKey: config.apiKey,
          "Content-Type": contentTypeFor(file.relativePath),
        },
        body,
      });
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await wait(250 * 2 ** (attempt - 1));
      continue;
    }

    if (response.ok) return;
    const detail = await response.text().catch(() => "");
    const error = new Error(
      `Upload failed for ${file.relativePath}: HTTP ${response.status} ${response.statusText}${detail ? `\n${detail}` : ""}`,
    );
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) throw error;
    await wait(250 * 2 ** (attempt - 1));
  }
}

async function uploadContentFiles(
  config: BunnyConfig,
  version: string,
  files: UploadFile[],
  concurrency: number,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (cursor < files.length) {
      const index = cursor++;
      const file = files[index]!;
      process.stdout.write(
        `[${index + 1}/${files.length + 1}] uploading ${file.relativePath} (${formatBytes(file.size)})... `,
      );
      await uploadFile(config, version, file);
      console.log("done");
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = await readManifest(opts.dir);
  process.stdout.write("verify:  checking hashes, dimensions, and frame references... ");
  await verifyAssetBundle(opts.dir);
  console.log("ok");
  const files = await collectFiles(opts.dir, manifest);
  const config = readBunnyConfig(opts.dryRun);

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
    console.log("  host:    storage.bunnycdn.com");
    console.log(`  zone:    ${process.env.BUNNY_STORAGE_ZONE?.trim() || DEFAULT_STORAGE_ZONE}`);
  }
  console.log(`  files:   ${files.length} (${formatBytes(totalBytes)} total)`);
  console.log("");

  if (opts.dryRun) {
    for (const [index, file] of files.entries()) {
      const prefix = `[${index + 1}/${files.length}]`;
      const remote = config
        ? remoteUrl(config.host, config.zone, manifest.gameVersion, file.relativePath)
        : `/${manifest.gameVersion}/${file.relativePath}`;
      console.log(`${prefix} ${file.relativePath}  ${formatBytes(file.size)}  -> ${remote}`);
    }
    console.log("\nDry run complete — no files uploaded.");
    return;
  }

  if (!config) throw new Error("BunnyCDN credentials are required for upload");
  const manifestFile = files.find((file) => file.relativePath === "manifest.json");
  if (!manifestFile) throw new Error("Upload set is missing manifest.json");
  const contentFiles = files.filter((file) => file !== manifestFile);
  await uploadContentFiles(config, manifest.gameVersion, contentFiles, opts.concurrency);
  process.stdout.write(
    `[${files.length}/${files.length}] publishing manifest.json (${formatBytes(manifestFile.size)})... `,
  );
  await uploadFile(config, manifest.gameVersion, manifestFile);
  console.log("done");
  console.log(`\nUploaded ${files.length} file(s) to /${manifest.gameVersion}/`);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nError: ${message}`);
    process.exit(1);
  });
}
