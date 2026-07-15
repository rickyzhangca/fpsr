import { access, readFile } from "node:fs/promises";
import path from "node:path";

export { localAssets } from "fpsr/node";

export async function assertAssetsDir(dir: string): Promise<void> {
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as {
      schema?: unknown;
      tiers?: { "2x"?: { renderDb?: { file?: unknown } } };
    };
    const renderDbFile = manifest.tiers?.["2x"]?.renderDb?.file;
    if (manifest.schema !== 2 || typeof renderDbFile !== "string") {
      throw new Error("invalid schema-2 manifest");
    }
    await access(path.join(dir, renderDbFile));
  } catch {
    throw new Error(
      `Assets not found in ${dir}\nExpected a schema-2 manifest and content-addressed render DB.\nRun: pnpm assets:build`,
    );
  }
}
