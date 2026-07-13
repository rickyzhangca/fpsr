#!/usr/bin/env tsx

import { access } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { goldenPngPath, loadCases } from "./cases.js";
import { ASSETS_DIR } from "./paths.js";
import { renderCase } from "./render-case.js";

async function main(): Promise<void> {
  try {
    await access(path.join(ASSETS_DIR, "render-db.json"));
    await access(path.join(ASSETS_DIR, "manifest.json"));
  } catch {
    throw new Error(
      `Assets not found in ${ASSETS_DIR}\nRun: pnpm -F @fpsr/pipeline run pipeline all`,
    );
  }

  const cases = loadCases();
  for (const c of cases) {
    const png = await renderCase(c, ASSETS_DIR);
    const outPath = goldenPngPath(c);
    await writeFile(outPath, png);
    console.log(`Wrote ${outPath} (${png.length} bytes)`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
