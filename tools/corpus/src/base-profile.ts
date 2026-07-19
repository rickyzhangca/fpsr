/**
 * Discover a Base-game placeable-entity inventory from Factorio `data.raw`.
 *
 * Inventory is derived from item-like prototypes whose primary icon is under
 * `__base__/`, plus ground rail shapes listed on a base rail-planner. This is
 * independent of render-db. Provenance records whether the caller supplied an
 * actual Base-only dump or only a merged/synthetic source.
 */

import type { RenderDb } from "@rickyzhangca/fpsr";

/** Loose Factorio data.raw: table name → prototype name → fields. */
export type DataRaw = Record<string, Record<string, Record<string, unknown>> | undefined>;

/** How a single entity entered the base profile. */
export type BaseProfileEvidence =
  | { kind: "place_result"; icon: string }
  | { kind: "rail-planner.rails"; planner: string; icon: string };

export interface BaseProfileEntry {
  entityName: string;
  itemName: string;
  itemType: string;
  /** Entity prototype table / type when discoverable in data.raw. */
  protoType: string | null;
  /** True when the discovering item (or entity) is marked hidden/internal. */
  hidden: boolean;
  evidence: BaseProfileEvidence;
}

/**
 * Explicit non-claims about the input dump and optional render-db.
 * Callers must not treat a merged official dump as proof of base completeness.
 */
export interface BaseProfileProvenance {
  inventorySource: "data-raw-__base__-icons";
  /** True only when the caller explicitly identifies the dump as Base-only. */
  claimsBaseOnlyOracle: boolean;
  /**
   * Caller-supplied dump provenance. Prefer `"merged-official-mods"` for the
   * committed all-official dump; `"base-only"` only when the dump truly is.
   */
  dumpStatus: "unknown" | "merged-official-mods" | "base-only" | "synthetic";
  renderDbMods?: string[];
}

export interface BaseProfileResult {
  entries: BaseProfileEntry[];
  provenance: BaseProfileProvenance;
  /** Present only when a RenderDb was supplied for comparison. */
  missingRenderDefs?: string[];
}

export interface DiscoverBaseProfileOptions {
  /** Optional pose/graphics DB — compared only; never filters inventory. */
  renderDb?: Pick<RenderDb, "entities" | "mods">;
  dumpStatus?: BaseProfileProvenance["dumpStatus"];
}

/** Prototype tables that are not entities (items, recipes, UI, etc.). */
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
  "virtual-signal",
  "achievement",
  "tips-and-tricks-item",
  "tutorial",
  "shortcut",
  "custom-input",
]);

function looksLikeEntity(p: Record<string, unknown>): boolean {
  return Array.isArray(p.collision_box) || Array.isArray(p.selection_box) || Array.isArray(p.flags);
}

/** Primary icon path: first `icons` layer, else singular `icon`. */
export function primaryIconPath(proto: Record<string, unknown>): string | null {
  const layers = proto.icons;
  if (Array.isArray(layers) && layers.length > 0) {
    const first = layers[0];
    if (
      first &&
      typeof first === "object" &&
      typeof (first as { icon?: unknown }).icon === "string"
    ) {
      return (first as { icon: string }).icon;
    }
  }
  return typeof proto.icon === "string" ? proto.icon : null;
}

export function isBaseIconPath(icon: string): boolean {
  return icon.startsWith("__base__/");
}

/** Elevated rails / ramp / support — excluded even when listed on a base planner. */
export function isExcludedElevatedRail(name: string, protoType?: string | null): boolean {
  if (name === "rail-ramp" || name === "rail-support") return true;
  if (name.startsWith("elevated-")) return true;
  if (protoType === "rail-ramp" || protoType === "rail-support") return true;
  if (protoType?.startsWith("elevated-")) return true;
  return false;
}

function findEntityProtoType(raw: DataRaw, name: string): string | null {
  for (const [table, protos] of Object.entries(raw)) {
    if (NON_ENTITY_TYPES.has(table)) continue;
    const p = protos?.[name];
    if (!p || typeof p !== "object") continue;
    if (!looksLikeEntity(p)) continue;
    return typeof p.type === "string" ? p.type : table;
  }
  return null;
}

function isHiddenProto(proto: Record<string, unknown>): boolean {
  if (proto.hidden === true) return true;
  const flags = proto.flags;
  return Array.isArray(flags) && flags.includes("hidden");
}

function entityHidden(raw: DataRaw, name: string): boolean {
  for (const [table, protos] of Object.entries(raw)) {
    if (NON_ENTITY_TYPES.has(table)) continue;
    const p = protos?.[name];
    if (!p || typeof p !== "object") continue;
    if (!looksLikeEntity(p)) continue;
    return isHiddenProto(p);
  }
  return false;
}

/**
 * Build a deterministic Base-game entity inventory from `data.raw`.
 *
 * Rules:
 * 1. Every prototype with `place_result` whose primary icon is `__base__/…`
 * 2. From each base-icon `rail-planner`, also take `.rails` ground shapes
 *    (exclude elevated / rail-ramp / rail-support)
 * 3. Preserve hidden/internal flags; sort by entity name
 * 4. Optional RenderDb only reports missing defs — never drops entries
 */
export function discoverBaseProfile(
  raw: DataRaw,
  options: DiscoverBaseProfileOptions = {},
): BaseProfileResult {
  const byEntity = new Map<string, BaseProfileEntry>();

  const consider = (entry: BaseProfileEntry): void => {
    if (isExcludedElevatedRail(entry.entityName, entry.protoType)) return;
    if (byEntity.has(entry.entityName)) return;
    byEntity.set(entry.entityName, entry);
  };

  for (const [itemType, protos] of Object.entries(raw)) {
    if (!protos || typeof protos !== "object") continue;
    for (const [itemName, proto] of Object.entries(protos)) {
      if (!proto || typeof proto !== "object") continue;
      const placeResult = proto.place_result;
      if (typeof placeResult !== "string") continue;

      const icon = primaryIconPath(proto);
      if (!icon || !isBaseIconPath(icon)) continue;

      const protoType = findEntityProtoType(raw, placeResult);
      consider({
        entityName: placeResult,
        itemName,
        itemType,
        protoType,
        hidden: isHiddenProto(proto) || entityHidden(raw, placeResult),
        evidence: { kind: "place_result", icon },
      });
    }
  }

  const planners = raw["rail-planner"];
  if (planners) {
    for (const [plannerName, proto] of Object.entries(planners)) {
      if (!proto || typeof proto !== "object") continue;
      const icon = primaryIconPath(proto);
      if (!icon || !isBaseIconPath(icon)) continue;

      const rails = proto.rails;
      if (!Array.isArray(rails)) continue;
      for (const rail of rails) {
        if (typeof rail !== "string") continue;
        const protoType = findEntityProtoType(raw, rail);
        consider({
          entityName: rail,
          itemName: plannerName,
          itemType: "rail-planner",
          protoType,
          hidden: isHiddenProto(proto) || entityHidden(raw, rail),
          evidence: { kind: "rail-planner.rails", planner: plannerName, icon },
        });
      }
    }
  }

  const entries = [...byEntity.values()].sort((a, b) =>
    a.entityName < b.entityName ? -1 : a.entityName > b.entityName ? 1 : 0,
  );

  const provenance: BaseProfileProvenance = {
    inventorySource: "data-raw-__base__-icons",
    claimsBaseOnlyOracle: options.dumpStatus === "base-only",
    dumpStatus: options.dumpStatus ?? "unknown",
  };
  if (options.renderDb) {
    provenance.renderDbMods = [...options.renderDb.mods];
  }

  const result: BaseProfileResult = { entries, provenance };

  if (options.renderDb) {
    result.missingRenderDefs = entries
      .map((e) => e.entityName)
      .filter((name) => options.renderDb!.entities[name] == null)
      .sort();
  }

  return result;
}
