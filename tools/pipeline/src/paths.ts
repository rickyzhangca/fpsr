import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (fpsr/). */
export const REPO_ROOT = path.resolve(here, "../../..");

export const GAME_VERSION = "2.1.9";

export const FACTORIO_APP = "/Applications/factorio.app/Contents";
export const FACTORIO_BIN = path.join(FACTORIO_APP, "MacOS/factorio");
export const FACTORIO_DATA = path.join(FACTORIO_APP, "data");

export const USER_DIR = path.join(process.env.HOME ?? "", "Library/Application Support/factorio");
export const SCRIPT_OUTPUT = path.join(USER_DIR, "script-output");
export const DUMP_SOURCE = path.join(SCRIPT_OUTPUT, "data-raw-dump.json");

export const TEMP_MOD_DIR = "/tmp/fpsr-mods";

export const ASSETS_OUT = path.join(REPO_ROOT, "assets-out");
export const DUMP_PATH = path.join(ASSETS_OUT, "data-raw-dump.json");
export const DUMP_META_PATH = path.join(ASSETS_OUT, "data-raw-dump.meta.json");
export const VERSION_OUT = path.join(ASSETS_OUT, GAME_VERSION);

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

export const ATLAS_MAX = 4096;

/** Map `__mod__/rest` sprite tokens to on-disk paths under the game data dir. */
export function resolveSpritePath(filename: string): string {
  const m = filename.match(/^__([^_]+(?:-[^_]+)*)__\/(.+)$/);
  if (!m) {
    throw new Error(`Unrecognized sprite path token: ${filename}`);
  }
  const mod = m[1];
  const rest = m[2];
  if (mod == null || rest == null) {
    throw new Error(`Unrecognized sprite path token: ${filename}`);
  }
  return path.join(FACTORIO_DATA, mod, rest);
}
