import { computeTileFrame, decode, selectBlueprint, type RenderDb } from "fpsr";
import { planDrawList } from "fpsr/planner";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ASSETS_DIR, GAME_VERSION } from "./paths.js";

export type ShotView = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Factorio zoom; 1 ⇒ 32 px/tile (matches fpsr ppt=32). */
  zoom: number;
};

const cachedDbs = new Map<string, RenderDb>();

async function loadRenderDb(assetsDir: string): Promise<RenderDb> {
  const root = path.resolve(assetsDir);
  const cached = cachedDbs.get(root);
  if (cached) return cached;
  const manifestPath = path.join(root, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      schema?: unknown;
      tiers?: { "2x"?: { renderDb?: { file?: unknown } } };
    };
    const renderDbFile = manifest.tiers?.["2x"]?.renderDb?.file;
    if (manifest.schema !== 2 || typeof renderDbFile !== "string") {
      throw new Error("invalid schema-2 manifest");
    }
    const dbPath = path.join(root, renderDbFile);
    const db = JSON.parse(await readFile(dbPath, "utf8")) as RenderDb;
    cachedDbs.set(root, db);
    return db;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot plan shot framing — invalid assets at ${root} (${reason}). ` +
        `Run: pnpm assets:build`,
    );
  }
}

/**
 * Use fpsr's draw-list bounds (+ padTiles) so Factorio's camera matches the
 * renderer canvas tile-for-tile.
 */
export async function planShotView(opts: {
  blueprint: string;
  pixelsPerTile: number;
  altMode?: boolean;
  padTiles?: number;
  assetsDir?: string;
}): Promise<ShotView> {
  const db = await loadRenderDb(opts.assetsDir ?? ASSETS_DIR);
  const bp = selectBlueprint(decode(opts.blueprint.trim()));
  const list = planDrawList(bp, db, { altMode: opts.altMode ?? true });
  if (!list.bounds) {
    throw new Error("planDrawList produced empty bounds");
  }
  const frame = computeTileFrame(list.bounds, opts.padTiles ?? 0);
  const zoom = opts.pixelsPerTile / 32;
  if (!(zoom > 0)) {
    throw new Error(`Invalid pixelsPerTile: ${opts.pixelsPerTile}`);
  }
  return {
    minX: frame.minX,
    minY: frame.minY,
    maxX: frame.maxX,
    maxY: frame.maxY,
    zoom,
  };
}

export function formatShotView(view: ShotView): string {
  const w = view.maxX - view.minX;
  const h = view.maxY - view.minY;
  const resX = Math.ceil(w * 32 * view.zoom);
  const resY = Math.ceil(h * 32 * view.zoom);
  return `${w}×${h} tiles → ${resX}×${resY}px @ zoom=${view.zoom} (fpsr ${GAME_VERSION})`;
}
