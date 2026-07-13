import {
  decodeVersion,
  type Blueprint,
  type BlueprintBook,
  type BlueprintBookEntry,
  type BlueprintDocument,
  type BlueprintEntity,
  type BlueprintInsertPlan,
} from "./types/blueprint.js";

/** Factorio 2.0+ major version encoded in blueprint `version` (major<<48). */
const FACTORIO_2_VERSION_MAJOR = 2 * 2 ** 48;

/**
 * A single 1.x → 2.x transform. Adapters run only while the blueprint's
 * encoded version major is still < 2; after the pipeline, major is bumped
 * to 2 so re-entry is a no-op.
 */
export type BlueprintAdapter = {
  /** Stable id for docs / debugging (e.g. "scale-legacy-directions"). */
  id: string;
  apply(bp: Blueprint): Blueprint;
};

/**
 * Factorio 1.x encodes directions as 0/2/4/6 (N/E/S/W); 2.x uses 0/4/8/12.
 * @see https://wiki.factorio.com/Blueprint_string_format
 */
const scaleLegacyDirections: BlueprintAdapter = {
  id: "scale-legacy-directions",
  apply(bp) {
    if (!bp.entities?.length) return bp;
    return {
      ...bp,
      entities: bp.entities.map((e) =>
        e.direction == null ? e : { ...e, direction: (e.direction * 2) % 16 },
      ),
    };
  },
};

/**
 * Factorio 1.x stores module/item requests as `{ "speed-module-3": 2 }`.
 * 2.x uses an insert-plan array: `[{ id: { name, type }, items: { grid_count } }]`.
 */
export function legacyItemsObjectToInsertPlans(items: unknown): BlueprintInsertPlan[] | undefined {
  if (items == null) return undefined;
  if (Array.isArray(items)) return items as BlueprintInsertPlan[];
  if (typeof items !== "object") return undefined;
  const out: BlueprintInsertPlan[] = [];
  for (const [name, count] of Object.entries(items as Record<string, unknown>)) {
    if (!name) continue;
    const gridCount = typeof count === "number" && Number.isFinite(count) ? count : 1;
    out.push({
      id: { name, type: "item" },
      items: { grid_count: gridCount },
    });
  }
  return out;
}

const itemsObjectToArray: BlueprintAdapter = {
  id: "items-object-to-array",
  apply(bp) {
    if (!bp.entities?.length) return bp;
    let changed = false;
    const entities = bp.entities.map((e) => {
      const raw = e.items as unknown;
      if (raw == null || Array.isArray(raw)) return e;
      if (typeof raw !== "object") return e;
      changed = true;
      const next: BlueprintEntity = {
        ...e,
        items: legacyItemsObjectToInsertPlans(raw),
      };
      return next;
    });
    return changed ? { ...bp, entities } : bp;
  },
};

/**
 * Ordered adapter registry. Add new 1.x→2.x transforms here; document ids in
 * docs/CONTRACTS.md. Future candidates (not implemented yet):
 * - connections-neighbours-to-wires
 * - rename-logistic-chests
 */
export const BLUEPRINT_ADAPTERS: readonly BlueprintAdapter[] = [
  scaleLegacyDirections,
  itemsObjectToArray,
];

function bumpVersionMajorTo2(version: number): number {
  return FACTORIO_2_VERSION_MAJOR + (version % 2 ** 48);
}

/**
 * Migrate a blueprint to Factorio 2.x shape for rendering.
 * Idempotent: 2.x (or already-migrated) blueprints are returned unchanged.
 */
export function migrateTo2x(bp: Blueprint): Blueprint {
  const ver = bp.version ?? 0;
  if (decodeVersion(ver).major >= 2) return bp;

  let out: Blueprint = { ...bp };
  for (const adapter of BLUEPRINT_ADAPTERS) {
    out = adapter.apply(out);
  }
  return { ...out, version: bumpVersionMajorTo2(ver) };
}

function migrateBookEntry(entry: BlueprintBookEntry): BlueprintBookEntry {
  let next = entry;
  if (entry.blueprint) {
    next = { ...next, blueprint: migrateTo2x(entry.blueprint) };
  }
  if (entry.blueprint_book) {
    next = { ...next, blueprint_book: migrateBook(entry.blueprint_book) };
  }
  return next;
}

function migrateBook(book: BlueprintBook): BlueprintBook {
  const ver = book.version ?? 0;
  const entries = book.blueprints?.map(migrateBookEntry);
  return {
    ...book,
    ...(entries ? { blueprints: entries } : {}),
    version: decodeVersion(ver).major >= 2 ? ver : bumpVersionMajorTo2(ver),
  };
}

/**
 * Migrate every nested blueprint in a document (bare bp or book tree).
 * Planners are left untouched. Idempotent.
 */
export function migrateDocumentTo2x(doc: BlueprintDocument): BlueprintDocument {
  if (doc.blueprint) {
    return { ...doc, blueprint: migrateTo2x(doc.blueprint) };
  }
  if (doc.blueprint_book) {
    return { ...doc, blueprint_book: migrateBook(doc.blueprint_book) };
  }
  return doc;
}
