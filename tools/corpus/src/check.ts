import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CanvasLike, createRenderer, decode, selectBlueprint } from "fpsr";
import type { RenderDb } from "fpsr";
import { planDrawList, resolve } from "fpsr/planner";
import { localAssets } from "fpsr/node";
import { Canvas } from "skia-canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIXTURE_DB = path.join(REPO_ROOT, "fixtures/render-db/2.1.11.json");
const CORPUS_DIR = path.join(REPO_ROOT, "fixtures/corpus");
const ASSETS_DIR = path.join(REPO_ROOT, "assets-out/2.1.11");
const PNG_DIR = "/tmp/fpsr-corpus";

interface CorpusIndex {
  groups: { id: string; file: string; entityCount: number; entities: string[] }[];
  tiles: { file: string; tileCount: number; tiles: string[] };
}

interface CoverageReport {
  totalEntities: number;
  rendered: number;
  placeholders: string[];
  warnings: string[];
  failures: string[];
}

async function main(): Promise<void> {
  const db = JSON.parse(await readFile(FIXTURE_DB, "utf8")) as RenderDb;
  const index = JSON.parse(
    await readFile(path.join(CORPUS_DIR, "index.json"), "utf8"),
  ) as CorpusIndex;

  await mkdir(PNG_DIR, { recursive: true });

  const placeholders = Object.entries(db.entities)
    .filter(([, e]) => e.data?.placeholder === true)
    .map(([n]) => n)
    .sort();

  const warnings: string[] = [];
  const failures: string[] = [];
  let rendered = 0;

  const renderer = await createRenderer({
    assets: localAssets(ASSETS_DIR),
    renderDb: db,
    createCanvas: (w, h) => new Canvas(w, h) as unknown as CanvasLike,
  });

  const files = [
    ...index.groups.map((g) => ({ id: g.id, file: g.file })),
    { id: "tiles", file: index.tiles.file },
  ];

  for (const { id, file } of files) {
    const bpPath = path.join(CORPUS_DIR, file);
    const source = (await readFile(bpPath, "utf8")).trim();
    try {
      const doc = decode(source);
      const bp = selectBlueprint(doc);
      const { warnings: resolveWarnings } = resolve(bp, db);
      for (const w of resolveWarnings) warnings.push(`[${id}] ${w}`);

      // Also plan to catch planner errors early.
      planDrawList(bp, db);

      const result = await renderer.render(doc, {
        pixelsPerTile: 16,
        background: { type: "none" },
      });
      const png = await result.toPngBuffer();
      await writeFile(path.join(PNG_DIR, `${id}.png`), png);
      rendered += bp.entities?.length ?? 0;
      console.log(
        `ok ${id}: ${result.width}x${result.height}, cmds=${result.drawList.commands.length}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`[${id}] ${msg}`);
      console.error(`FAIL ${id}: ${msg}`);
    }
  }

  const report: CoverageReport = {
    totalEntities: Object.keys(db.entities).length,
    rendered,
    placeholders,
    warnings,
    failures,
  };

  await writeFile(path.join(CORPUS_DIR, "coverage.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `coverage: entities=${report.totalEntities} renderedPlacements=${rendered} placeholders=${placeholders.length} warnings=${warnings.length} failures=${failures.length}`,
  );
  if (placeholders.length) console.log(`placeholders: ${placeholders.join(", ")}`);
  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
