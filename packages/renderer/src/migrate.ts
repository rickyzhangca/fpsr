import {
  decodeVersion,
  type Blueprint,
  type BlueprintBook,
  type BlueprintBookEntry,
  type BlueprintDocument,
  type BlueprintEntity,
  type BlueprintInsertPlan,
  type BlueprintWire,
} from "./types/blueprint.js";
import { WIRE_CONNECTOR_ID } from "./wire-connectors.js";

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

type LegacyConnectionLink = {
  entity_id?: unknown;
  circuit_id?: unknown;
};

/**
 * Map 1.x connection point (1=input/default, 2=output) + wire color to 2.x
 * `defines.wire_connector_id`.
 */
function legacyCircuitConnectorId(point: number, color: "red" | "green"): number {
  if (point === 2) {
    return color === "red"
      ? WIRE_CONNECTOR_ID.combinator_output_red
      : WIRE_CONNECTOR_ID.combinator_output_green;
  }
  return color === "red" ? WIRE_CONNECTOR_ID.circuit_red : WIRE_CONNECTOR_ID.circuit_green;
}

function canonicalizeWire(wire: BlueprintWire): BlueprintWire {
  const [a, ac, b, bc] = wire;
  if (a < b || (a === b && ac <= bc)) return wire;
  return [b, bc, a, ac];
}

function wireKey(wire: BlueprintWire): string {
  const [a, ac, b, bc] = canonicalizeWire(wire);
  return `${a},${ac},${b},${bc}`;
}

/**
 * Factorio 1.x stores circuit links on each entity as `connections` and copper
 * pole links as `neighbours`. 2.x uses a single top-level `wires` array of
 * `[src, src_connector, dst, dst_connector]` tuples.
 *
 * @see https://wiki.factorio.com/Blueprint_string_format
 * @see https://wiki.factorio.com/Talk:Blueprint_string_format
 */
const connectionsNeighboursToWires: BlueprintAdapter = {
  id: "connections-neighbours-to-wires",
  apply(bp) {
    if (!bp.entities?.length) return bp;
    const seen = new Set<string>();
    const wires: BlueprintWire[] = [];

    const addWire = (wire: BlueprintWire) => {
      const key = wireKey(wire);
      if (seen.has(key)) return;
      seen.add(key);
      wires.push(canonicalizeWire(wire));
    };

    for (const existing of bp.wires ?? []) {
      if (Array.isArray(existing) && existing.length >= 4) {
        addWire([existing[0], existing[1], existing[2], existing[3]]);
      }
    }

    let converted = false;
    for (const entity of bp.entities) {
      const connections = (entity as { connections?: unknown }).connections;
      if (connections && typeof connections === "object") {
        for (const [pointKey, colors] of Object.entries(connections as Record<string, unknown>)) {
          const point = Number(pointKey);
          if (point !== 1 && point !== 2) continue;
          if (!colors || typeof colors !== "object") continue;
          for (const color of ["red", "green"] as const) {
            const links = (colors as Record<string, unknown>)[color];
            if (!Array.isArray(links)) continue;
            const srcConnector = legacyCircuitConnectorId(point, color);
            for (const link of links as LegacyConnectionLink[]) {
              const dstEntity = link?.entity_id;
              if (typeof dstEntity !== "number" || !Number.isFinite(dstEntity)) continue;
              const dstPoint =
                typeof link.circuit_id === "number" && Number.isFinite(link.circuit_id)
                  ? link.circuit_id
                  : 1;
              if (dstPoint !== 1 && dstPoint !== 2) continue;
              converted = true;
              addWire([
                entity.entity_number,
                srcConnector,
                dstEntity,
                legacyCircuitConnectorId(dstPoint, color),
              ]);
            }
          }
        }
      }

      const neighbours = (entity as { neighbours?: unknown }).neighbours;
      if (Array.isArray(neighbours)) {
        for (const neighbor of neighbours) {
          if (typeof neighbor !== "number" || !Number.isFinite(neighbor)) continue;
          converted = true;
          addWire([
            entity.entity_number,
            WIRE_CONNECTOR_ID.pole_copper,
            neighbor,
            WIRE_CONNECTOR_ID.pole_copper,
          ]);
        }
      }
    }

    if (!converted && wires.length === (bp.wires?.length ?? 0)) return bp;
    return { ...bp, wires };
  },
};

/**
 * Factorio 2.0 renames that appear in 1.x blueprint entity `name` fields.
 * Mirrors `base/migrations` entity maps plus the engine rail prototype rename
 * (`straight-rail`/`curved-rail` → `legacy-*`; new 2.0 rails reuse those names).
 *
 * Stack/bulk swap follows `1.2.0 stack inserter rename.json` (applied before
 * `2.0.0.json` in Factorio): 1.x `stack-inserter` becomes `bulk-inserter`.
 */
const LEGACY_ENTITY_RENAMES: Readonly<Record<string, string>> = {
  "straight-rail": "legacy-straight-rail",
  "curved-rail": "legacy-curved-rail",
  "filter-inserter": "fast-inserter",
  "stack-filter-inserter": "bulk-inserter",
  "stack-inserter": "bulk-inserter",
  "logistic-chest-passive-provider": "passive-provider-chest",
  "logistic-chest-active-provider": "active-provider-chest",
  "logistic-chest-storage": "storage-chest",
  "logistic-chest-buffer": "buffer-chest",
  "logistic-chest-requester": "requester-chest",
};

function renameLegacyEntityName(name: string): string {
  return LEGACY_ENTITY_RENAMES[name] ?? name;
}

/**
 * Rename 1.x entity prototype names to their 2.x equivalents so render-db
 * lookups succeed (and 1.x rails don't resolve to the new 2.0 rail protos).
 */
const renameLegacyEntities: BlueprintAdapter = {
  id: "rename-legacy-entities",
  apply(bp) {
    let changed = false;

    const entities = bp.entities?.map((e) => {
      const next = renameLegacyEntityName(e.name);
      if (next === e.name) return e;
      changed = true;
      return { ...e, name: next };
    });

    const icons = bp.icons?.map((icon) => {
      const signal = icon.signal;
      if (!signal?.name) return icon;
      const next = renameLegacyEntityName(signal.name);
      if (next === signal.name) return icon;
      changed = true;
      return { ...icon, signal: { ...signal, name: next } };
    });

    if (!changed) return bp;
    return {
      ...bp,
      ...(entities ? { entities } : {}),
      ...(icons ? { icons } : {}),
    };
  },
};

/**
 * Ordered adapter registry. Add new 1.x→2.x transforms here; document ids in
 * docs/CONTRACTS.md.
 */
export const BLUEPRINT_ADAPTERS: readonly BlueprintAdapter[] = [
  scaleLegacyDirections,
  itemsObjectToArray,
  connectionsNeighboursToWires,
  renameLegacyEntities,
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
  if ("blueprint" in entry && entry.blueprint) {
    const { blueprint, ...rest } = entry;
    return { ...rest, index: entry.index, blueprint: migrateTo2x(blueprint) };
  }
  if ("blueprint_book" in entry && entry.blueprint_book) {
    const { blueprint_book, ...rest } = entry;
    return { ...rest, index: entry.index, blueprint_book: migrateBook(blueprint_book) };
  }
  return entry;
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
