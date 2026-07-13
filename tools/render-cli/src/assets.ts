import { access } from "node:fs/promises";
import path from "node:path";

export { localAssets } from "fpsr/node";

export async function assertAssetsDir(dir: string): Promise<void> {
  const required = ["render-db.json", "manifest.json"];
  for (const file of required) {
    try {
      await access(path.join(dir, file));
    } catch {
      throw new Error(
        `Assets not found in ${dir}\nExpected render-db.json and manifest.json.\nRun: pnpm -F @fpsr/pipeline run pipeline all`,
      );
    }
  }
}
