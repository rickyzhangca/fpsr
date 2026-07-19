import { altSignalFrame } from "../alt-mode-signals.js";
import type { SignalId } from "../types/blueprint.js";
import { compareDrawCmd, RENDER_LAYERS, type DrawList, type IconCmd } from "../types/draw-list.js";
import type { RenderDb } from "../types/render-db.js";
import {
  UPGRADE_PLANNER_SLOT_COUNT,
  upgradePlannerMappers,
  type UpgradeMapper,
  type UpgradeMapperDestination,
  type UpgradeMapperSource,
  type UpgradePlanner,
} from "../upgrade-planner.js";
import { expandBounds, includeCmdBounds } from "./bounds.js";

/** Columns in the Factorio upgrade planner filter window. */
export const UPGRADE_PLANNER_COLUMNS = 4;

/** Each mapper slot occupies three 1×1 tiles: from, arrow, to. */
const SLOT_TILES = 3;
/** Empty tiles between adjacent mapper pairs (and between rows). */
const PAIR_GAP = 1;
/** Empty tiles around the full grid. */
const OUTER_PAD = 1;
const ICON_SIZE = 1;
const RIGHT_ARROW_ICON_KEY = "virtual-signal/right-arrow";

function mapperSignal(
  side: UpgradeMapperSource | UpgradeMapperDestination | undefined,
): SignalId | undefined {
  if (!side?.name) return undefined;
  return {
    name: side.name,
    type: side.type ?? "entity",
    ...(typeof side.quality === "string" && side.quality !== "normal"
      ? { quality: side.quality }
      : {}),
  };
}

/** Tile-center for column `tileX` and row `tileY` (integer tile indices). */
function tileCenter(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX + 0.5, y: tileY + 0.5 };
}

/** Rows needed to cover filled mapper slots (trailing empty rows are omitted). */
function occupiedRows(slots: (UpgradeMapper | undefined)[]): number {
  let maxIndex = -1;
  for (let index = 0; index < slots.length; index++) {
    if (slots[index]) maxIndex = index;
  }
  if (maxIndex < 0) return 0;
  return Math.floor(maxIndex / UPGRADE_PLANNER_COLUMNS) + 1;
}

function gridSize(rows: number): { width: number; height: number } {
  const cols = UPGRADE_PLANNER_COLUMNS;
  return {
    width: OUTER_PAD + cols * SLOT_TILES + (cols - 1) * PAIR_GAP + OUTER_PAD,
    height: rows === 0 ? OUTER_PAD * 2 : OUTER_PAD + rows + (rows - 1) * PAIR_GAP + OUTER_PAD,
  };
}

function gridBounds(rows: number): DrawList["bounds"] {
  const { width, height } = gridSize(rows);
  return { minX: 0, minY: 0, maxX: width, maxY: height };
}

function mapperIconCommand(
  db: RenderDb,
  side: UpgradeMapperSource | UpgradeMapperDestination | undefined,
  x: number,
  y: number,
  entity: number,
  sub: number,
): IconCmd | undefined {
  const signal = mapperSignal(side);
  if (!signal) return undefined;
  const frame = altSignalFrame(db, signal) ?? db.icons["utility/missing-icon"];
  if (frame === undefined) return undefined;
  return {
    kind: "icon",
    layer: RENDER_LAYERS.icons,
    sortY: y,
    sortX: x,
    entity,
    sub,
    frame,
    x,
    y,
    size: ICON_SIZE,
  };
}

function arrowCommand(db: RenderDb, x: number, y: number, entity: number): IconCmd | undefined {
  const frame = db.icons[RIGHT_ARROW_ICON_KEY] ?? db.icons["utility/missing-icon"];
  if (frame === undefined) return undefined;
  return {
    kind: "icon",
    layer: RENDER_LAYERS.icons,
    sortY: y,
    sortX: x,
    entity,
    sub: 1,
    frame,
    x,
    y,
    size: ICON_SIZE,
  };
}

/**
 * Plan a Factorio-style upgrade planner filter window as a draw list:
 * filled slots as from → right-arrow → to on a 1×1 tile grid (4 columns),
 * with 1-tile gaps between pairs and 1-tile outer padding.
 * Height covers only rows up to the last occupied mapper index.
 */
export function planUpgradePlannerDrawList(
  planner: Record<string, unknown> | UpgradePlanner,
  db: RenderDb,
): DrawList {
  const slots = upgradePlannerMappers(planner);
  const rows = occupiedRows(slots);
  const commands: IconCmd[] = [];
  let bounds: DrawList["bounds"] | null = gridBounds(rows);
  const colStride = SLOT_TILES + PAIR_GAP;
  const rowStride = 1 + PAIR_GAP;
  const slotLimit = Math.min(UPGRADE_PLANNER_SLOT_COUNT, rows * UPGRADE_PLANNER_COLUMNS);

  for (let index = 0; index < slotLimit; index++) {
    const mapper = slots[index];
    if (!mapper) continue;
    const col = index % UPGRADE_PLANNER_COLUMNS;
    const row = Math.floor(index / UPGRADE_PLANNER_COLUMNS);
    const baseX = OUTER_PAD + col * colStride;
    const baseY = OUTER_PAD + row * rowStride;
    const entity = index + 1;

    const fromPos = tileCenter(baseX, baseY);
    const fromCmd = mapperIconCommand(db, mapper.from, fromPos.x, fromPos.y, entity, 0);
    if (fromCmd) {
      commands.push(fromCmd);
      bounds = includeCmdBounds(bounds, fromCmd, db.frames);
    }

    const arrowPos = tileCenter(baseX + 1, baseY);
    const arrowCmd = arrowCommand(db, arrowPos.x, arrowPos.y, entity);
    if (arrowCmd) {
      commands.push(arrowCmd);
      bounds = includeCmdBounds(bounds, arrowCmd, db.frames);
    }

    const toPos = tileCenter(baseX + 2, baseY);
    const toCmd = mapperIconCommand(db, mapper.to, toPos.x, toPos.y, entity, 2);
    if (toCmd) {
      commands.push(toCmd);
      bounds = includeCmdBounds(bounds, toCmd, db.frames);
    }
  }

  if (!bounds) {
    bounds = gridBounds(rows);
  } else {
    const grid = gridBounds(rows);
    bounds = expandBounds(
      bounds,
      grid.minX,
      grid.minY,
      grid.maxX - grid.minX,
      grid.maxY - grid.minY,
    );
  }

  commands.sort(compareDrawCmd);
  return { schema: 1, bounds, commands };
}
