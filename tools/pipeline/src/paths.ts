import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (fpsr/). */
export const REPO_ROOT = path.resolve(here, "../../..");
export const ASSETS_OUT = path.join(REPO_ROOT, "assets-out");

/** fpsr-owned art (not from Wube); baked into render-db during distill. */
export const PIPELINE_ASSETS = path.join(REPO_ROOT, "tools/pipeline/assets");
export const UNSUPPORTED_ENTITY_PNG = path.join(PIPELINE_ASSETS, "unsupported-entity.png");

export const OFFICIAL_MODS = [
  "base",
  "elevated-rails",
  "quality",
  "recycler",
  "space-age",
] as const;

export interface FactorioInstall {
  root: string;
  binary: string;
  data: string;
  version: string;
}

export interface PipelinePaths {
  install: FactorioInstall;
  assetsOut: string;
  dumpPath: string;
  dumpMetaPath: string;
  versionOut: string;
  dumpSource: string;
  tempModDir: string;
}

let configured: PipelinePaths | undefined;

function isFile(filename: string): boolean {
  try {
    return statSync(filename).isFile();
  } catch {
    return false;
  }
}

function installFromRoot(root: string): FactorioInstall | undefined {
  const normalized = path.resolve(root);
  const data = path.join(normalized, "data");
  const infoPath = path.join(data, "base", "info.json");
  if (!existsSync(infoPath)) return undefined;

  const binaryCandidates = [
    path.join(normalized, "MacOS", "factorio"),
    path.join(normalized, "bin", "x64", "factorio"),
    path.join(normalized, "bin", "x64", "factorio.exe"),
    path.join(normalized, "factorio"),
    path.join(normalized, "factorio.exe"),
  ];
  const binary = binaryCandidates.find(isFile);
  if (!binary) return undefined;

  const info = JSON.parse(readFileSync(infoPath, "utf8")) as { version?: unknown };
  if (typeof info.version !== "string" || info.version.length === 0) {
    throw new Error(`Factorio base metadata is missing version: ${infoPath}`);
  }
  return { root: normalized, binary, data, version: info.version };
}

function rootsForInput(input: string): string[] {
  const absolute = path.resolve(input);
  const roots = [absolute, path.join(absolute, "Contents")];
  if (isFile(absolute)) {
    const parent = path.dirname(absolute);
    roots.push(parent, path.dirname(parent), path.dirname(path.dirname(parent)));
  }
  return [...new Set(roots)];
}

function standardInstallRoots(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      "/Applications/Factorio.app/Contents",
      path.join(home, "Applications/Factorio.app/Contents"),
      path.join(
        home,
        "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents",
      ),
    ];
  }
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    return [
      path.join(programFiles, "Factorio"),
      path.join(programFilesX86, "Steam/steamapps/common/Factorio"),
    ];
  }
  return [
    "/opt/factorio",
    path.join(home, ".factorio"),
    path.join(home, ".steam/steam/steamapps/common/Factorio"),
    path.join(home, ".local/share/Steam/steamapps/common/Factorio"),
  ];
}

export function discoverFactorioInstall(explicitPath?: string): FactorioInstall {
  const requested = explicitPath?.trim() || process.env.FPSR_FACTORIO_PATH?.trim();
  const roots = requested ? rootsForInput(requested) : standardInstallRoots();
  for (const root of roots) {
    const install = installFromRoot(root);
    if (install) return install;
  }
  const source = requested ? `configured path ${requested}` : "standard installation locations";
  throw new Error(
    `Factorio installation not found in ${source}. Pass --factorio <path> or set FPSR_FACTORIO_PATH.`,
  );
}

function factorioUserDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library/Application Support/factorio");
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData/Roaming"), "Factorio");
  }
  return path.join(home, ".factorio");
}

export function configurePipelinePaths(
  options: {
    factorioPath?: string;
    assetsOut?: string;
  } = {},
): PipelinePaths {
  const install = discoverFactorioInstall(options.factorioPath);
  const assetsOut = path.resolve(options.assetsOut ?? ASSETS_OUT);
  configured = {
    install,
    assetsOut,
    dumpPath: path.join(assetsOut, "data-raw-dump.json"),
    dumpMetaPath: path.join(assetsOut, "data-raw-dump.meta.json"),
    versionOut: path.join(assetsOut, install.version),
    dumpSource: path.join(factorioUserDir(), "script-output/data-raw-dump.json"),
    tempModDir: path.join(os.tmpdir(), "fpsr-mods"),
  };
  return configured;
}

export function getPipelinePaths(): PipelinePaths {
  return configured ?? configurePipelinePaths();
}

/** Map `__mod__/rest` sprite tokens to on-disk paths under the game data dir. */
export function resolveSpritePath(filename: string): string {
  const match = filename.match(/^__([^_]+(?:-[^_]+)*)__\/(.+)$/);
  if (!match?.[1] || !match[2]) throw new Error(`Unrecognized sprite path token: ${filename}`);
  return path.join(getPipelinePaths().install.data, match[1], match[2]);
}
