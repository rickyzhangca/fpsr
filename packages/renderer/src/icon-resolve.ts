import type { RenderDb } from "./types/render-db.js";

/** Resolve a render-db icon key to a frame id, including tile placing-item fallback. */
export function resolveIconFrameId(db: RenderDb, iconKey: string): number | undefined {
  const direct = db.icons[iconKey];
  if (direct !== undefined) return direct;

  if (!iconKey.startsWith("item/")) return undefined;

  const tileName = iconKey.slice("item/".length);
  const placingItem = db.tiles[tileName]?.item;
  if (!placingItem) return undefined;

  return db.icons[`item/${placingItem}`];
}
