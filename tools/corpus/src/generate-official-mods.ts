import { encode, type RenderDb } from "fpsr";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOfficialModSuite } from "./official-mod-suite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RENDER_DB_PATH = path.join(REPO_ROOT, "fixtures/render-db/2.1.11.json");
const OUTPUT_DIR = path.join(REPO_ROOT, "fixtures/visual-tests/official-mods");

async function main(): Promise<void> {
  const renderDb = JSON.parse(await readFile(RENDER_DB_PATH, "utf8")) as RenderDb;
  const suite = buildOfficialModSuite(renderDb);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    ...suite.books.map((book) =>
      writeFile(path.join(OUTPUT_DIR, book.file), `${encode(book.document)}\n`),
    ),
    writeFile(
      path.join(OUTPUT_DIR, "manifest.json"),
      `${JSON.stringify(suite.manifest, null, 2)}\n`,
    ),
  ]);

  const coverage = suite.manifest.coverage;
  console.log(
    [
      `wrote ${path.relative(REPO_ROOT, OUTPUT_DIR)}`,
      `${suite.books.length} books`,
      `${coverage.pageCount} pages`,
      `${coverage.entityPlacementCaseCount} entity placements`,
      `${coverage.tileCaseCount} tile patches`,
      `${suite.manifest.rendererDiagnostics.length} renderer diagnostics`,
    ].join(" · "),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
