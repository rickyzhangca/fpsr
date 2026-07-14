import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function assetsAvailable(dir: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as {
      schema?: unknown;
      renderDb?: { file?: unknown };
    };
    if (manifest.schema !== 2 || typeof manifest.renderDb?.file !== "string") return false;
    await access(path.join(dir, manifest.renderDb.file));
    return true;
  } catch {
    return false;
  }
}
