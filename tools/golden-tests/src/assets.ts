import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function assetsAvailable(dir: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as {
      schema?: unknown;
      tiers?: { "2x"?: { renderDb?: { file?: unknown } } };
    };
    const renderDbFile = manifest.tiers?.["2x"]?.renderDb?.file;
    if (manifest.schema !== 2 || typeof renderDbFile !== "string") return false;
    await access(path.join(dir, renderDbFile));
    return true;
  } catch {
    return false;
  }
}
