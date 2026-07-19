import { BLUEPRINT_ADAPTERS, decodeVersion, type Blueprint } from "fpsr";

const ADAPTER_LABELS: Record<string, string> = {
  "scale-legacy-directions": "Legacy directions",
  "items-object-to-array": "Legacy item format",
  "connections-neighbours-to-wires": "Legacy circuit wires",
  "rename-legacy-entities": "Legacy entity names",
};

export type AdapterCheck = {
  id: string;
  label: string;
  used: boolean;
  affectedEntities: number;
};

const changedEntityCount = (before: Blueprint, after: Blueprint): number => {
  const beforeEntities = before.entities ?? [];
  const afterEntities = after.entities ?? [];
  const count = Math.max(beforeEntities.length, afterEntities.length);
  let changed = 0;
  for (let index = 0; index < count; index++) {
    if (JSON.stringify(beforeEntities[index]) !== JSON.stringify(afterEntities[index]))
      changed += 1;
  }
  return changed;
};

export const getAdapterChecks = (bp: Blueprint | null): AdapterCheck[] => {
  if (!bp || decodeVersion(bp.version ?? 0).major >= 2) {
    return BLUEPRINT_ADAPTERS.map((adapter) => ({
      id: adapter.id,
      label: ADAPTER_LABELS[adapter.id] ?? adapter.id,
      used: false,
      affectedEntities: 0,
    }));
  }
  let current = bp;
  return BLUEPRINT_ADAPTERS.map((adapter) => {
    const before = current;
    const after = adapter.apply(before);
    const used = JSON.stringify(before) !== JSON.stringify(after);
    const affectedEntities = used ? Math.max(1, changedEntityCount(before, after)) : 0;
    current = after;
    return {
      id: adapter.id,
      label: ADAPTER_LABELS[adapter.id] ?? adapter.id,
      used,
      affectedEntities,
    };
  });
};
