import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (fpsr/). */
export const REPO_ROOT = path.resolve(here, "../../..");

export const GAME_VERSION = "2.1.9";

export const FACTORIO_APP = "/Applications/factorio.app/Contents";
export const FACTORIO_BIN = path.join(FACTORIO_APP, "MacOS/factorio");

export const USER_DIR = path.join(process.env.HOME ?? "", "Library/Application Support/factorio");
export const SCRIPT_OUTPUT = path.join(USER_DIR, "script-output");
export const RIG_SCRIPT_OUTPUT = path.join(SCRIPT_OUTPUT, "fpsr-rig");

export const GROUND_TRUTH_OUT = path.join(REPO_ROOT, "fixtures/ground-truth");
export const ASSETS_DIR = path.join(REPO_ROOT, "assets-out", GAME_VERSION);

export const RIG_MOD_TEMPLATE = path.resolve(here, "../rig-mod");

/** Per-run staging root (official mod-list + fpsr-rig copy). */
export const TEMP_MOD_DIR_PREFIX = "/tmp/fpsr-ground-truth-mods";

export const OFFICIAL_MODS = [
  "base",
  "elevated-rails",
  "quality",
  "recycler",
  "space-age",
] as const;

export const SENTINEL_DONE = "FPSR_RIG_DONE";
export const SENTINEL_SHOT = "FPSR_RIG_SHOT";
export const SENTINEL_ERROR = "FPSR_RIG_ERROR";

/** Hard kill after this many ms (single-job default; batch adds 30s/job). */
export const HARD_TIMEOUT_MS = 120_000;

/** Grace period after SIGTERM before SIGKILL. */
export const TERM_GRACE_MS = 5_000;
