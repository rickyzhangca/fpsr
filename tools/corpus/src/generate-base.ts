import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encode, type RenderDb } from "@rickyzhangca/fpsr";
import { buildBaseSuite } from "./base-suite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RENDER_DB_PATH = path.join(REPO_ROOT, "fixtures/render-db/2.1.11-base.json");
const OUTPUT_DIR = path.join(REPO_ROOT, "fixtures/visual-tests/base-game");

async function main(): Promise<void> {
  const renderDb = JSON.parse(await readFile(RENDER_DB_PATH, "utf8")) as RenderDb;
  const suite = buildBaseSuite(renderDb);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(path.join(OUTPUT_DIR, "book.bp.txt"), `${encode(suite.document)}\n`),
    writeFile(
      path.join(OUTPUT_DIR, "manifest.json"),
      `${JSON.stringify(suite.manifest, null, 2)}\n`,
    ),
  ]);

  const coverage = suite.manifest.coverage;
  console.log(
    [
      `wrote ${path.relative(REPO_ROOT, OUTPUT_DIR)}`,
      `${coverage.pageCount} pages`,
      `${coverage.entityPoseCaseCount} pose cases`,
      `${coverage.adjacencyMaskCaseCount} adjacency masks`,
      `${coverage.beltNeighborhoodCaseCount} belt neighborhoods`,
      `${coverage.tileCaseCount} tile cases`,
    ].join(" · "),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
