import { filledBlueprintIcons } from "./blueprint-icons.js";
import type { Color, Icon } from "./types/blueprint.js";

/** Factorio default entity filter slot count on the deconstruction planner. */
export const DECONSTRUCTION_ENTITY_FILTER_SLOT_COUNT = 30;
/** Factorio default tile filter slot count on the deconstruction planner. */
export const DECONSTRUCTION_TILE_FILTER_SLOT_COUNT = 30;

/** `defines.deconstruction_item.entity_filter_mode` / `tile_filter_mode`. */
export type DeconstructionFilterMode = "whitelist" | "blacklist";

/** `defines.deconstruction_item.tile_selection_mode`. */
export type DeconstructionTileSelectionMode = "normal" | "always" | "never" | "only";

export interface DeconstructionEntityFilter {
  index: number;
  name?: string;
  type?: string;
  quality?: string;
  comparator?: string;
  [key: string]: unknown;
}

export interface DeconstructionTileFilter {
  index: number;
  name?: string;
  [key: string]: unknown;
}

export interface DeconstructionPlannerSettings {
  entity_filters?: DeconstructionEntityFilter[];
  tile_filters?: DeconstructionTileFilter[];
  /** 0 whitelist, 1 blacklist (Factorio enum). */
  entity_filter_mode?: number;
  /** 0 whitelist, 1 blacklist (Factorio enum). */
  tile_filter_mode?: number;
  /** 0 normal, 1 always, 2 never, 3 only (Factorio enum). */
  tile_selection_mode?: number;
  trees_and_rocks_only?: boolean;
  [key: string]: unknown;
}

export interface DeconstructionPlanner {
  item?: string;
  label?: string;
  label_color?: Color;
  description?: string;
  icons?: Icon[];
  version?: number;
  settings?: DeconstructionPlannerSettings;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIndexedFilter(
  value: unknown,
): { index: number; rest: Record<string, unknown> } | undefined {
  if (!isPlainObject(value)) return undefined;
  const index = value.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return undefined;
  return { index, rest: value };
}

function parseEntityFilter(value: unknown): DeconstructionEntityFilter | undefined {
  const parsed = parseIndexedFilter(value);
  if (!parsed) return undefined;
  return { ...parsed.rest, index: parsed.index };
}

function parseTileFilter(value: unknown): DeconstructionTileFilter | undefined {
  const parsed = parseIndexedFilter(value);
  if (!parsed) return undefined;
  return { ...parsed.rest, index: parsed.index };
}

function readFilterMode(value: unknown): DeconstructionFilterMode {
  return value === 1 ? "blacklist" : "whitelist";
}

function readTileSelectionMode(value: unknown): DeconstructionTileSelectionMode {
  switch (value) {
    case 1:
      return "always";
    case 2:
      return "never";
    case 3:
      return "only";
    default:
      return "normal";
  }
}

function settingsOf(
  planner: Record<string, unknown> | DeconstructionPlanner,
): DeconstructionPlannerSettings | undefined {
  const settings = planner.settings;
  return isPlainObject(settings) ? (settings as DeconstructionPlannerSettings) : undefined;
}

/**
 * Expand `settings.entity_filters` into a fixed-length slot array keyed by `index`.
 * Out-of-range indices are ignored. Duplicate indices keep the last filter.
 */
export function deconstructionEntityFilters(
  planner: Record<string, unknown> | DeconstructionPlanner,
): (DeconstructionEntityFilter | undefined)[] {
  const slots: (DeconstructionEntityFilter | undefined)[] = Array.from(
    { length: DECONSTRUCTION_ENTITY_FILTER_SLOT_COUNT },
    () => undefined,
  );
  const settings = settingsOf(planner);
  const filters = settings?.entity_filters;
  if (!Array.isArray(filters)) return slots;
  for (const entry of filters) {
    const filter = parseEntityFilter(entry);
    if (!filter || filter.index >= DECONSTRUCTION_ENTITY_FILTER_SLOT_COUNT) continue;
    slots[filter.index] = filter;
  }
  return slots;
}

/**
 * Expand `settings.tile_filters` into a fixed-length slot array keyed by `index`.
 * Out-of-range indices are ignored. Duplicate indices keep the last filter.
 */
export function deconstructionTileFilters(
  planner: Record<string, unknown> | DeconstructionPlanner,
): (DeconstructionTileFilter | undefined)[] {
  const slots: (DeconstructionTileFilter | undefined)[] = Array.from(
    { length: DECONSTRUCTION_TILE_FILTER_SLOT_COUNT },
    () => undefined,
  );
  const settings = settingsOf(planner);
  const filters = settings?.tile_filters;
  if (!Array.isArray(filters)) return slots;
  for (const entry of filters) {
    const filter = parseTileFilter(entry);
    if (!filter || filter.index >= DECONSTRUCTION_TILE_FILTER_SLOT_COUNT) continue;
    slots[filter.index] = filter;
  }
  return slots;
}

export function deconstructionEntityFilterMode(
  planner: Record<string, unknown> | DeconstructionPlanner,
): DeconstructionFilterMode {
  return readFilterMode(settingsOf(planner)?.entity_filter_mode);
}

export function deconstructionTileFilterMode(
  planner: Record<string, unknown> | DeconstructionPlanner,
): DeconstructionFilterMode {
  return readFilterMode(settingsOf(planner)?.tile_filter_mode);
}

export function deconstructionTileSelectionMode(
  planner: Record<string, unknown> | DeconstructionPlanner,
): DeconstructionTileSelectionMode {
  return readTileSelectionMode(settingsOf(planner)?.tile_selection_mode);
}

export function deconstructionTreesAndRocksOnly(
  planner: Record<string, unknown> | DeconstructionPlanner,
): boolean {
  return settingsOf(planner)?.trees_and_rocks_only === true;
}

export function formatDeconstructionFilterMode(mode: DeconstructionFilterMode): string {
  return mode === "blacklist" ? "Blacklist" : "Whitelist";
}

export function formatDeconstructionTileSelectionMode(
  mode: DeconstructionTileSelectionMode,
): string {
  switch (mode) {
    case "always":
      return "Always";
    case "never":
      return "Never";
    case "only":
      return "Only";
    default:
      return "Normal";
  }
}

/**
 * Icons for the deconstruction-planner inventory thumbnail.
 * Prefers an explicit `icons` field; `trees_and_rocks_only` uses tree-01;
 * otherwise uses the first filled entity filters then tile filters (max 4).
 */
export function deconstructionPlannerIcons(
  planner: Record<string, unknown> | DeconstructionPlanner,
): Icon[] {
  const typed = planner as DeconstructionPlanner;
  const explicit = filledBlueprintIcons(typed.icons);
  if (explicit.length > 0) return explicit;

  if (deconstructionTreesAndRocksOnly(planner)) {
    return [{ index: 1, signal: { name: "tree-01", type: "entity" } }];
  }

  const icons: Icon[] = [];
  for (const filter of deconstructionEntityFilters(planner)) {
    if (!filter?.name) continue;
    const quality = filter.quality;
    icons.push({
      index: icons.length + 1,
      signal: {
        name: filter.name,
        type: filter.type ?? "entity",
        ...(typeof quality === "string" && quality !== "normal" ? { quality } : {}),
      },
    });
    if (icons.length >= 4) return icons;
  }
  for (const filter of deconstructionTileFilters(planner)) {
    if (!filter?.name) continue;
    icons.push({
      index: icons.length + 1,
      signal: { name: filter.name, type: "tile" },
    });
    if (icons.length >= 4) break;
  }
  return icons;
}

/** Read a typed deconstruction planner view from an opaque document payload. */
export function asDeconstructionPlanner(
  planner: Record<string, unknown> | DeconstructionPlanner,
): DeconstructionPlanner {
  return planner as DeconstructionPlanner;
}
