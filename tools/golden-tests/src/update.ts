#!/usr/bin/env tsx

import { writeFile } from "node:fs/promises";
import { assetsAvailable } from "./assets.js";
import { goldenPngPath, loadCases } from "./cases.js";
import { ASSETS_DIR } from "./paths.js";
import { renderCase } from "./render-case.js";

async function main(): Promise<void> {
  if (!(await assetsAvailable(ASSETS_DIR))) {
    throw new Error(`Assets not found in ${ASSETS_DIR}\nRun: pnpm assets:build`);
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
