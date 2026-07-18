import type { BlueprintEntity, BlueprintFilter, SignalId } from "./types/blueprint.js";
import type { EntityRenderDef, RenderDb } from "./types/render-db.js";

export type AltSignal = SignalId & { type: string };

const SIGNAL_PREFIX: Record<string, string> = {
  item: "item",
  fluid: "fluid",
  virtual: "virtual-signal",
  "virtual-signal": "virtual-signal",
  entity: "entity",
  recipe: "recipe",
  quality: "quality",
  "space-location": "space-location",
  "asteroid-chunk": "asteroid-chunk",
};

export function asSignal(value: unknown, defaultType = "item"): AltSignal | undefined {
  if (typeof value === "string") return { name: value, type: defaultType };
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (obj.id && typeof obj.id === "object") return asSignal(obj.id, defaultType);
  if (obj.value && typeof obj.value === "object") return asSignal(obj.value, defaultType);
  if (obj.signal && typeof obj.signal === "object") return asSignal(obj.signal, defaultType);
  if (typeof obj.name !== "string") return undefined;
  return {
    name: obj.name,
    type: typeof obj.type === "string" ? obj.type : defaultType,
    ...(typeof obj.quality === "string" ? { quality: obj.quality } : {}),
  };
}

export function signalKey(signal: SignalId): string {
  return `${signal.type ?? "item"}/${signal.name}/${signal.quality ?? "normal"}`;
}

export function collectSignals(
  value: unknown,
  defaultType = "item",
  out: AltSignal[] = [],
): AltSignal[] {
  if (Array.isArray(value)) {
    for (const item of value) collectSignals(item, defaultType, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const obj = value as Record<string, unknown>;
  const direct = asSignal(obj, defaultType);
  if (direct) {
    out.push(direct);
    return out;
  }
  for (const [key, child] of Object.entries(obj)) {
    if (key === "index" || key === "count" || key === "comparator") continue;
    collectSignals(child, defaultType, out);
  }
  return out;
}

export function filterSignals(
  filters: BlueprintFilter[] | undefined,
  defaultType = "item",
): AltSignal[] {
  return collectSignals(filters ?? [], defaultType);
}

export function uniqueSignals(signals: AltSignal[]): AltSignal[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = signalKey(signal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Ordered render-db icon keys for a Blueprint SignalID (UI lookup chain). */
export function signalIconKeys(signal: SignalId): string[] {
  const type = signal.type ?? "item";
  const prefix = SIGNAL_PREFIX[type] ?? type;
  const primary = `${prefix}/${signal.name}`;

  switch (type) {
    case "item":
      return [primary, `entity/${signal.name}`, `recipe/${signal.name}`];
    case "entity":
      return [primary, `item/${signal.name}`];
    case "recipe":
      return [primary, `item/${signal.name}`];
    default:
      return [primary];
  }
}

/** Resolve Blueprint SignalID namespaces and tolerate older/default item shapes. */
export function altSignalFrame(db: RenderDb, signal: SignalId): number | undefined {
  for (const key of signalIconKeys(signal)) {
    const frame = db.icons[key];
    if (frame !== undefined) return frame;
  }
  return undefined;
}

export function isSplitterType(def: EntityRenderDef): boolean {
  return def.protoType === "splitter" || def.protoType === "lane-splitter";
}

/** Splitter filters render on the output-priority lane, not as centered primary icons. */
export function splitterLaneFilter(
  entity: BlueprintEntity,
  def: EntityRenderDef,
): AltSignal | undefined {
  if (!isSplitterType(def)) return undefined;
  if (!entity.output_priority || entity.output_priority === "none") return undefined;
  return asSignal(entity.filter) ?? filterSignals(entity.filters)[0];
}

export function entitySignals(entity: BlueprintEntity, def: EntityRenderDef): AltSignal[] {
  const signals: AltSignal[] = [];
  if (entity.recipe) {
    signals.push({ name: entity.recipe, type: "recipe", quality: entity.recipe_quality });
  }

  // Splitter output filters are placed on the priority lane in splitterPriorityCommands.
  if (!splitterLaneFilter(entity, def)) {
    const directFilter = asSignal(
      entity.filter,
      def.protoType === "mining-drill" ? "entity" : "item",
    );
    if (directFilter) signals.push(directFilter);
    signals.push(...filterSignals(entity.filters));
  }
  signals.push(...filterSignals(entity["priority-list"]));
  signals.push(...filterSignals(entity["chunk-filter"], "asteroid-chunk"));
  if (entity.fluid_filter) signals.push({ name: entity.fluid_filter, type: "fluid" });

  for (const inventory of [
    entity.inventory,
    entity.trunk_inventory,
    entity.ammo_inventory,
    entity.burner_fuel_inventory,
    entity["result-inventory"],
  ]) {
    signals.push(...filterSignals(inventory?.filters));
  }
  signals.push(...collectSignals(entity.request_filters));
  // Combinator / display-panel control_behavior drives built-in graphics (or
  // conditional messages); Factorio does not dump those as entity-info icons.
  // Display panels only expose a static single entity.icon in alt mode.
  if (entity.icon) signals.push({ ...entity.icon, type: entity.icon.type ?? "item" });

  return uniqueSignals(signals);
}

export type ResolvedAltSignal = { signal: AltSignal; frame: number };

export function resolveAltSignals(db: RenderDb, signals: AltSignal[]): ResolvedAltSignal[] {
  return signals
    .map((signal) => ({
      signal,
      frame: altSignalFrame(db, signal) ?? db.icons["utility/missing-icon"],
    }))
    .filter((entry): entry is ResolvedAltSignal => entry.frame !== undefined);
}
