import { access } from "node:fs/promises";
import path from "node:path";

export async function assetsAvailable(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, "render-db.json"));
    await access(path.join(dir, "manifest.json"));
    return true;
  } catch {
    return false;
  }
}
