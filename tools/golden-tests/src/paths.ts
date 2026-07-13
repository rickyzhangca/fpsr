import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const GOLDEN_DIR = path.join(REPO_ROOT, "fixtures/golden");
export const ASSETS_DIR = path.join(REPO_ROOT, "assets-out/2.1.9");
export const DIFF_DIR = path.join(GOLDEN_DIR, "__diff__");
