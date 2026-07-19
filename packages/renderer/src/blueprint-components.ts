import { migrateTo2x } from "./migrate.js";
import type { Blueprint } from "./types/blueprint.js";
import type { RenderDb } from "./types/render-db.js";

/** Ground rail pieces that place from the `rail` item. */
const RAIL_COMPONENT_NAMES = new Set([
  "straight-rail",
  "curved-rail-a",
  "curved-rail-b",
  "half-diagonal-rail",
  "legacy-straight-rail",
  "legacy-curved-rail",
]);

/** Placing-item / remapped name + instance count. */
export interface BlueprintComponentCount {
  name: string;
  count: number;
}

/**
 * Summarize blueprint inventory for UI (item icons).
 * - Migrates 1.x names first (`migrateTo2x`) so icons resolve in the 2.x render-db
 * - Ground rail pieces (straight/curved/half-diagonal + legacy) → `"rail"`
 * - Tiles → `db.tiles[name].item` when present, else tile prototype name
 * - All other entities → prototype name
 *
 * Sorted by count descending, then name ascending.
 */
export function countBlueprintComponents(bp: Blueprint, db: RenderDb): BlueprintComponentCount[] {
  const migrated = migrateTo2x(bp);
  const counts = new Map<string, number>();
  for (const entity of migrated.entities ?? []) {
    const key = RAIL_COMPONENT_NAMES.has(entity.name) ? "rail" : entity.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const tile of migrated.tiles ?? []) {
    const key = db.tiles[tile.name]?.item ?? tile.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
