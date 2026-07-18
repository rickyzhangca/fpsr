import type {
  BlueprintBook,
  BlueprintEntity,
  DrawCmd,
  EntityRenderDef,
  FrameMeta,
  Icon,
  RenderDb,
  Tile,
} from "fpsr";
import { planDrawList } from "fpsr";

export const BLUEPRINT_VERSION = 2 * 2 ** 48 + 1 * 2 ** 32 + 11 * 2 ** 16;
export const CASES_PER_ROW = 4;
export const CASE_GAP_TILES = 1;
export const CROP_MARGIN_TILES = CASE_GAP_TILES / 2;

export interface SuiteCaseBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SuiteLattice {
  x: 0 | 0.5;
  y: 0 | 0.5;
}

export interface SuitePlacement {
  entities?: BlueprintEntity[];
  tiles?: Tile[];
  focusEntityNumbers?: number[];
}

export function itemIcons(...names: string[]): Icon[] {
  return names.slice(0, 4).map((name, index) => ({
    index: index + 1,
    signal: { type: "item", name },
  }));
}

export function makeBook(
  label: string,
  icons: Icon[],
  entries: BlueprintBook["blueprints"],
): BlueprintBook {
  return {
    item: "blueprint-book",
    label,
    icons,
    active_index: 0,
    version: BLUEPRINT_VERSION,
    blueprints: entries,
  };
}

export function includeBounds(
  current: SuiteCaseBounds | null,
  next: SuiteCaseBounds,
): SuiteCaseBounds {
  if (!current) return next;
  return {
    left: Math.min(current.left, next.left),
    top: Math.min(current.top, next.top),
    right: Math.max(current.right, next.right),
    bottom: Math.max(current.bottom, next.bottom),
  };
}

export function cleanCoordinate(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function entityBounds(entity: BlueprintEntity, def: EntityRenderDef): SuiteCaseBounds {
  const [[left, top], [right, bottom]] = def.selectionBox;
  const angle =
    entity.orientation != null
      ? entity.orientation * Math.PI * 2
      : ((entity.direction ?? 0) / 16) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let bounds: SuiteCaseBounds | null = null;
  for (const [x, y] of [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ] as const) {
    const rotatedX = x * cos - y * sin + entity.position.x;
    const rotatedY = x * sin + y * cos + entity.position.y;
    bounds = includeBounds(bounds, {
      left: rotatedX,
      top: rotatedY,
      right: rotatedX,
      bottom: rotatedY,
    });
  }
  if (!bounds) return { left: -0.5, top: -0.5, right: 0.5, bottom: 0.5 };
  return {
    left: cleanCoordinate(bounds.left),
    top: cleanCoordinate(bounds.top),
    right: cleanCoordinate(bounds.right),
    bottom: cleanCoordinate(bounds.bottom),
  };
}

function spriteVisualBounds(
  command: Extract<DrawCmd, { kind: "sprite" }>,
  frame: FrameMeta | undefined,
): SuiteCaseBounds {
  if (!frame) {
    return {
      left: command.x,
      top: command.y,
      right: command.x + command.w,
      bottom: command.y + command.h,
    };
  }

  const scaleX = frame.sw === 0 ? 0 : command.w / frame.sw;
  const scaleY = frame.sh === 0 ? 0 : command.h / frame.sh;
  const centerX = command.x + command.w / 2;
  const centerY = command.y + command.h / 2;
  let left = command.x + frame.ox * scaleX;
  let top = command.y + frame.oy * scaleY;
  let right = left + frame.w * scaleX;
  let bottom = top + frame.h * scaleY;

  if (command.flipX) [left, right] = [2 * centerX - right, 2 * centerX - left];
  if (command.flipY) [top, bottom] = [2 * centerY - bottom, 2 * centerY - top];

  const rotation = command.rotation ?? 0;
  if (rotation % 360 !== 0) {
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const corners = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ] as const;
    const rotated = corners.map(([x, y]) => {
      const dx = x - centerX;
      const dy = y - centerY;
      return [centerX + dx * cos - dy * sin, centerY + dx * sin + dy * cos] as const;
    });
    left = Math.min(...rotated.map(([x]) => x));
    top = Math.min(...rotated.map(([, y]) => y));
    right = Math.max(...rotated.map(([x]) => x));
    bottom = Math.max(...rotated.map(([, y]) => y));
  }

  if (command.clip) {
    left = Math.max(left, command.clip.x);
    top = Math.max(top, command.clip.y);
    right = Math.max(left, Math.min(right, command.clip.x + command.clip.w));
    bottom = Math.max(top, Math.min(bottom, command.clip.y + command.clip.h));
  }
  return { left, top, right, bottom };
}

function commandVisualBounds(command: DrawCmd, frames: FrameMeta[]): SuiteCaseBounds | null {
  if (command.kind === "sprite") return spriteVisualBounds(command, frames[command.frame]);
  if (command.kind === "rect") {
    return {
      left: command.x,
      top: command.y,
      right: command.x + command.w,
      bottom: command.y + command.h,
    };
  }
  return null;
}

export function placementBounds(placement: SuitePlacement, renderDb: RenderDb): SuiteCaseBounds {
  let bounds: SuiteCaseBounds | null = null;
  const drawList = planDrawList(
    {
      item: "blueprint",
      version: BLUEPRINT_VERSION,
      ...(placement.entities?.length ? { entities: placement.entities } : {}),
      ...(placement.tiles?.length ? { tiles: placement.tiles } : {}),
    },
    renderDb,
  );
  for (const command of drawList.commands) {
    if (command.kind === "sprite" && command.shadow) continue;
    const commandBounds = commandVisualBounds(command, renderDb.frames);
    if (commandBounds) bounds = includeBounds(bounds, commandBounds);
  }
  if (bounds) {
    return {
      left: cleanCoordinate(bounds.left),
      top: cleanCoordinate(bounds.top),
      right: cleanCoordinate(bounds.right),
      bottom: cleanCoordinate(bounds.bottom),
    };
  }

  // Defensive fallback for an entity whose current resolver emits no visible
  // command. Normal generated cases take the draw-list path above.
  for (const entity of placement.entities ?? []) {
    const def = renderDb.entities[entity.name];
    if (!def) throw new Error(`Missing render metadata for ${entity.name}`);
    bounds = includeBounds(bounds, entityBounds(entity, def));
  }
  return bounds ?? { left: -0.5, top: -0.5, right: 0.5, bottom: 0.5 };
}

export function placementLattice(placement: SuitePlacement, renderDb: RenderDb): SuiteLattice {
  const first = placement.entities?.[0];
  if (!first) return { x: 0, y: 0 };
  const def = renderDb.entities[first.name];
  if (!def) throw new Error(`Missing render metadata for ${first.name}`);

  // Rails and rolling stock use the rail grid/off-grid coordinates rather than
  // ordinary building tile parity. Keep their generated anchor on integers.
  if (def.kind === "rail" || def.kind === "train") return { x: 0, y: 0 };

  // Cars/spider vehicles are placeable off-grid. A tile center is the least
  // surprising deterministic anchor for a visual contact sheet.
  if (def.protoType === "car" || def.protoType === "spider-vehicle") {
    return { x: 0.5, y: 0.5 };
  }

  // Offshore pumps declare a 1×1 placement footprint even though their
  // asymmetric shoreline selection box is roughly 1×2.
  if (first.name === "offshore-pump") return { x: 0.5, y: 0.5 };

  const width = Math.max(1, Math.round(def.selectionBox[1][0] - def.selectionBox[0][0]));
  const height = Math.max(1, Math.round(def.selectionBox[1][1] - def.selectionBox[0][1]));
  const quarterTurns = Math.round((first.direction ?? 0) / 4) % 4;
  const placedWidth = quarterTurns % 2 === 0 ? width : height;
  const placedHeight = quarterTurns % 2 === 0 ? height : width;
  return {
    x: placedWidth % 2 === 0 ? 0 : 0.5,
    y: placedHeight % 2 === 0 ? 0 : 0.5,
  };
}

/** Smallest lattice-aligned translation that keeps a local bound at or after `minimum`. */
export function packedTranslation(minimum: number, localBound: number, fraction: 0 | 0.5): number {
  return Math.ceil(minimum - localBound - fraction - Number.EPSILON * 8) + fraction;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export interface PackedCasePlacement<T extends { bounds: SuiteCaseBounds; lattice: SuiteLattice }> {
  item: T;
  translateX: number;
  translateY: number;
  placedBounds: SuiteCaseBounds;
}

/** Pack case rows with one empty tile between neighbors; returns translated placements. */
export function packCaseRows<T extends { bounds: SuiteCaseBounds; lattice: SuiteLattice }>(
  rows: T[][],
): PackedCasePlacement<T>[][] {
  const packed: PackedCasePlacement<T>[][] = [];
  let rowTop = 0;

  for (const row of rows) {
    let previousRight: number | null = null;
    let rowBottom = rowTop;
    const packedRow: PackedCasePlacement<T>[] = [];

    for (const item of row) {
      const minimumLeft = previousRight == null ? 0 : previousRight + CASE_GAP_TILES;
      const translateX = packedTranslation(minimumLeft, item.bounds.left, item.lattice.x);
      const translateY = packedTranslation(rowTop, item.bounds.top, item.lattice.y);
      const placedBounds = {
        left: item.bounds.left + translateX,
        top: item.bounds.top + translateY,
        right: item.bounds.right + translateX,
        bottom: item.bounds.bottom + translateY,
      };
      previousRight = placedBounds.right;
      rowBottom = Math.max(rowBottom, placedBounds.bottom);
      packedRow.push({ item, translateX, translateY, placedBounds });
    }

    packed.push(packedRow);
    rowTop = rowBottom + CASE_GAP_TILES;
  }

  return packed;
}
