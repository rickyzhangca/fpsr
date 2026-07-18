import { compareDrawCmd, type Blueprint, type DrawList, type RenderDb } from "fpsr";

export interface UnsupportedBlueprintContent {
  name: string;
  count: number;
  entityNumbers?: number[];
}

export interface PlanDiagnostics {
  entities: {
    total: number;
    resolved: number;
    unsupported: UnsupportedBlueprintContent[];
  };
  tiles: {
    total: number;
    resolved: number;
    unsupported: UnsupportedBlueprintContent[];
  };
  drawList: {
    commandCount: number;
    byKind: Record<string, number>;
    uniqueFrames: number;
    uniqueLayers: number;
    atlasIndices: number[];
  };
  checks: {
    finiteBounds: boolean;
    finiteCommands: boolean;
    sortedCommands: boolean;
    validFrameReferences: boolean;
  };
}

const countUnsupported = (
  values: readonly { name: string; entity_number?: number }[],
  isSupported: (name: string) => boolean,
): UnsupportedBlueprintContent[] => {
  const counts = new Map<string, { count: number; entityNumbers: number[] }>();
  for (const value of values) {
    if (isSupported(value.name)) continue;
    const entry = counts.get(value.name) ?? { count: 0, entityNumbers: [] };
    entry.count += 1;
    if (value.entity_number != null) entry.entityNumbers.push(value.entity_number);
    counts.set(value.name, entry);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      ...(value.entityNumbers.length > 0 ? { entityNumbers: value.entityNumbers } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const hasOnlyFiniteNumbers = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasOnlyFiniteNumbers);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(hasOnlyFiniteNumbers);
  }
  return true;
};

const countValues = (values: readonly UnsupportedBlueprintContent[]): number => {
  return values.reduce((sum, value) => sum + value.count, 0);
};

export const analyzePlan = (
  blueprint: Blueprint,
  drawList: DrawList,
  db: RenderDb,
): PlanDiagnostics => {
  const entities = blueprint.entities ?? [];
  const tiles = blueprint.tiles ?? [];
  const unsupportedEntities = countUnsupported(entities, (name) => db.entities[name] != null);
  const unsupportedTiles = countUnsupported(tiles, (name) => db.tiles[name] != null);
  const byKind: Record<string, number> = {};
  const frames = new Set<number>();
  const layers = new Set<number>();
  const atlases = new Set<number>();
  let validFrameReferences = true;

  for (const command of drawList.commands) {
    byKind[command.kind] = (byKind[command.kind] ?? 0) + 1;
    layers.add(command.layer);
    if (command.kind !== "sprite" && command.kind !== "icon") continue;
    const frameIds = [command.frame];
    if (command.kind === "icon" && command.backingFrame != null) {
      frameIds.push(command.backingFrame);
    }
    for (const frameId of frameIds) {
      frames.add(frameId);
      const frame = db.frames[frameId];
      if (!frame) {
        validFrameReferences = false;
        continue;
      }
      atlases.add(frame.a);
    }
  }

  const { bounds } = drawList;
  const finiteBounds =
    hasOnlyFiniteNumbers(bounds) && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY;
  const sortedCommands = drawList.commands.every((command, index) => {
    const previous = drawList.commands[index - 1];
    return !previous || compareDrawCmd(previous, command) <= 0;
  });

  return {
    entities: {
      total: entities.length,
      resolved: entities.length - countValues(unsupportedEntities),
      unsupported: unsupportedEntities,
    },
    tiles: {
      total: tiles.length,
      resolved: tiles.length - countValues(unsupportedTiles),
      unsupported: unsupportedTiles,
    },
    drawList: {
      commandCount: drawList.commands.length,
      byKind,
      uniqueFrames: frames.size,
      uniqueLayers: layers.size,
      atlasIndices: [...atlases].sort((a, b) => a - b),
    },
    checks: {
      finiteBounds,
      finiteCommands: drawList.commands.every(hasOnlyFiniteNumbers),
      sortedCommands,
      validFrameReferences,
    },
  };
};
