import { filledBlueprintIcons } from "./blueprint-icons.js";
import type { Color, Icon } from "./types/blueprint.js";

/** Factorio upgrade planner filter window has 24 entity slot pairs. */
export const UPGRADE_PLANNER_SLOT_COUNT = 24;

/** Source side of an upgrade mapper (`UpgradeMapperSource`). */
export interface UpgradeMapperSource {
  type?: string;
  name?: string;
  quality?: string;
  comparator?: string;
  [key: string]: unknown;
}

/** Destination side of an upgrade mapper (`UpgradeMapperDestination`). */
export interface UpgradeMapperDestination {
  type?: string;
  name?: string;
  quality?: string;
  module_limit?: number;
  module_slots?: unknown[];
  [key: string]: unknown;
}

export interface UpgradeMapper {
  index: number;
  from?: UpgradeMapperSource;
  to?: UpgradeMapperDestination;
  [key: string]: unknown;
}

export interface UpgradePlanner {
  item?: string;
  label?: string;
  label_color?: Color;
  description?: string;
  icons?: Icon[];
  version?: number;
  settings?: {
    mappers?: UpgradeMapper[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMapperSide(
  value: unknown,
): UpgradeMapperSource | UpgradeMapperDestination | undefined {
  if (!isPlainObject(value)) return undefined;
  return value as UpgradeMapperSource;
}

function parseMapper(value: unknown): UpgradeMapper | undefined {
  if (!isPlainObject(value)) return undefined;
  const index = value.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return undefined;
  return {
    ...value,
    index,
    from: parseMapperSide(value.from),
    to: parseMapperSide(value.to),
  };
}

/**
 * Expand `settings.mappers` into a fixed-length slot array keyed by `mapper.index`.
 * Out-of-range indices are ignored. Duplicate indices keep the last mapper.
 */
export function upgradePlannerMappers(
  planner: Record<string, unknown> | UpgradePlanner,
): (UpgradeMapper | undefined)[] {
  const slots: (UpgradeMapper | undefined)[] = Array.from(
    { length: UPGRADE_PLANNER_SLOT_COUNT },
    () => undefined,
  );
  const settings = planner.settings;
  if (!isPlainObject(settings)) return slots;
  const mappers = settings.mappers;
  if (!Array.isArray(mappers)) return slots;
  for (const entry of mappers) {
    const mapper = parseMapper(entry);
    if (!mapper || mapper.index >= UPGRADE_PLANNER_SLOT_COUNT) continue;
    slots[mapper.index] = mapper;
  }
  return slots;
}

/**
 * Icons for the upgrade-planner inventory thumbnail.
 * Prefers an explicit `icons` field; otherwise uses the `to` side of the first
 * four filled mapper pairs (Factorio GUI behavior).
 */
export function upgradePlannerIcons(planner: Record<string, unknown> | UpgradePlanner): Icon[] {
  const typed = planner as UpgradePlanner;
  const explicit = filledBlueprintIcons(typed.icons);
  if (explicit.length > 0) return explicit;

  const icons: Icon[] = [];
  for (const mapper of upgradePlannerMappers(planner)) {
    if (!mapper?.to?.name) continue;
    const quality = mapper.to.quality;
    icons.push({
      index: icons.length + 1,
      signal: {
        name: mapper.to.name,
        type: mapper.to.type ?? "entity",
        ...(typeof quality === "string" && quality !== "normal" ? { quality } : {}),
      },
    });
    if (icons.length >= 4) break;
  }
  return icons;
}

/** Read a typed upgrade planner view from an opaque document payload. */
export function asUpgradePlanner(
  planner: Record<string, unknown> | UpgradePlanner,
): UpgradePlanner {
  return planner as UpgradePlanner;
}
