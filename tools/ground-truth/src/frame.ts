import type { RenderDb } from "fpsr";
import { computeTileFrame, decode, planDrawList, selectBlueprint } from "fpsr";
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

let cachedDb: RenderDb | null = null;

async function loadRenderDb(): Promise<RenderDb> {
  if (cachedDb) return cachedDb;
  const manifestPath = path.join(ASSETS_DIR, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      schema?: unknown;
      tiers?: { "2x"?: { renderDb?: { file?: unknown } } };
    };
    const renderDbFile = manifest.tiers?.["2x"]?.renderDb?.file;
    if (manifest.schema !== 2 || typeof renderDbFile !== "string") {
      throw new Error("invalid schema-2 manifest");
    }
    const dbPath = path.join(ASSETS_DIR, renderDbFile);
    cachedDb = JSON.parse(await readFile(dbPath, "utf8")) as RenderDb;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot plan shot framing — invalid assets at ${ASSETS_DIR} (${reason}). ` +
        `Run: pnpm assets:build`,
    );
  }
  return cachedDb;
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
}): Promise<ShotView> {
  const db = await loadRenderDb();
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
