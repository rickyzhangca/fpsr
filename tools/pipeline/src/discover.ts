import type { DataRaw } from "./types.js";

/** Prototype categories that are items / non-entities. */
const NON_ENTITY_TYPES = new Set([
  "item",
  "item-with-entity-data",
  "item-with-inventory",
  "item-with-label",
  "item-with-tags",
  "rail-planner",
  "module",
  "ammo",
  "gun",
  "armor",
  "capsule",
  "tool",
  "repair-tool",
  "mining-tool",
  "blueprint",
  "deconstruction-item",
  "upgrade-item",
  "blueprint-book",
  "selection-tool",
  "copy-paste-tool",
  "spidertron-remote",
  "rocket-silo-rocket",
  "recipe",
  "fluid",
  "tile",
  "technology",
  "font",
  "gui-style",
  "utility-constants",
  "utility-sounds",
  "utility-sprites",
  "sprite",
  "noise-expression",
  "noise-function",
  "mouse-cursor",
  "virtual-signal",
  "entity-ghost",
  "tile-ghost",
  "collision-layer",
  "trivial-smoke",
  "particle",
  "optimized-particle",
  "stream",
  "projectile",
  "sticker",
  "fire",
  "explosion",
  "beam",
  "artillery-flare",
  "artillery-projectile",
  "achievement",
  "tips-and-tricks-item",
  "tutorial",
  "shortcut",
  "custom-input",
]);

export interface PlaceableEntity {
  name: string;
  type: string;
  proto: Record<string, unknown>;
}

function looksLikeEntity(p: Record<string, unknown>): boolean {
  return Array.isArray(p.collision_box) || Array.isArray(p.selection_box) || Array.isArray(p.flags);
}

/**
 * Find the entity prototype for a place_result name. Skips item/recipe tables
 * and non-entity categories; requires collision/selection box or flags.
 */
export function findEntityProto(
  raw: DataRaw,
  name: string,
): { type: string; proto: Record<string, unknown> } | null {
  // Prefer a table whose key equals the prototype's own `type` field when present.
  for (const [t, protos] of Object.entries(raw)) {
    if (NON_ENTITY_TYPES.has(t)) continue;
    const p = protos?.[name];
    if (!p || typeof p !== "object") continue;
    if (!looksLikeEntity(p)) continue;
    return { type: t, proto: p };
  }
  return null;
}

/**
 * Collect blueprint-placeable entities: anything an item places via place_result,
 * plus all rails listed on rail-planner prototypes. Requires `player-creation`
 * flag (or rail type) so natural plants / editor-only junk are skipped.
 */
export function discoverPlaceableEntities(raw: DataRaw): PlaceableEntity[] {
  const names = new Set<string>();

  for (const protos of Object.values(raw)) {
    if (!protos || typeof protos !== "object") continue;
    for (const p of Object.values(protos)) {
      if (!p || typeof p !== "object") continue;
      const pr = (p as { place_result?: unknown }).place_result;
      if (typeof pr === "string") names.add(pr);
    }
  }

  for (const p of Object.values(raw["rail-planner"] ?? {})) {
    if (!p || typeof p !== "object") continue;
    const rails = (p as { rails?: unknown }).rails;
    if (Array.isArray(rails)) {
      for (const r of rails) {
        if (typeof r === "string") names.add(r);
      }
    }
  }

  // Factorio 2.x keeps 1.x rails as blueprint-only prototypes (not on rail-planner,
  // no place_result). Still needed to render migrated 1.x / legacy blueprints.
  for (const name of ["legacy-straight-rail", "legacy-curved-rail"] as const) {
    names.add(name);
  }

  const out: PlaceableEntity[] = [];
  for (const name of [...names].sort()) {
    const found = findEntityProto(raw, name);
    if (!found) continue;
    const flags = (found.proto.flags as string[] | undefined) ?? [];
    const isRail =
      found.type.includes("rail") ||
      found.type === "rail-ramp" ||
      found.type === "rail-support" ||
      found.type === "rail-signal" ||
      found.type === "rail-chain-signal";
    if (!flags.includes("player-creation") && !isRail) continue;
    // Skip plants / trees even if somehow flagged.
    if (found.type === "plant" || found.type === "tree") continue;
    out.push({ name, type: found.type, proto: found.proto });
  }
  return out;
}

/**
 * Tiles placeable via an item's place_as_tile.result, plus hazard-concrete-right
 * variants that exist as sibling tiles of the left (item-placed) forms.
 */
export function discoverPlaceableTiles(raw: DataRaw): string[] {
  const names = new Set<string>();
  for (const protos of Object.values(raw)) {
    if (!protos || typeof protos !== "object") continue;
    for (const p of Object.values(protos)) {
      if (!p || typeof p !== "object") continue;
      const pat = (p as { place_as_tile?: { result?: unknown } }).place_as_tile;
      if (pat && typeof pat.result === "string") names.add(pat.result);
    }
  }
  // Sibling right-hazard tiles (placed by rotating the left item in-game).
  for (const n of names) {
    if (n.endsWith("-left")) {
      const right = `${n.slice(0, -5)}-right`;
      if (raw.tile?.[right]) names.add(right);
    }
  }
  return [...names].filter((n) => !!raw.tile?.[n]).sort();
}

/**
 * Reverse map from tile prototype name to the item that places it via
 * `place_as_tile.result`, including sibling `-right` hazard tiles.
 */
export function discoverTilePlacingItems(raw: DataRaw): Record<string, string> {
  const map: Record<string, string> = {};
  for (const protos of Object.values(raw)) {
    if (!protos || typeof protos !== "object") continue;
    for (const [itemName, p] of Object.entries(protos)) {
      if (!p || typeof p !== "object") continue;
      const pat = (p as { place_as_tile?: { result?: unknown } }).place_as_tile;
      if (pat && typeof pat.result === "string") map[pat.result] = itemName;
    }
  }
  for (const [tileName, itemName] of Object.entries(map)) {
    if (tileName.endsWith("-left")) {
      const right = `${tileName.slice(0, -5)}-right`;
      if (raw.tile?.[right] && map[right] === undefined) map[right] = itemName;
    }
  }
  return map;
}
