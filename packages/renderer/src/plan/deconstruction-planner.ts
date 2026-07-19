import { altSignalFrame } from "../alt-mode-signals.js";
import {
  deconstructionEntityFilterMode,
  deconstructionEntityFilters,
  deconstructionTileFilterMode,
  deconstructionTileFilters,
  deconstructionTileSelectionMode,
  deconstructionTreesAndRocksOnly,
  formatDeconstructionFilterMode,
  formatDeconstructionTileSelectionMode,
  type DeconstructionEntityFilter,
  type DeconstructionPlanner,
  type DeconstructionTileFilter,
} from "../deconstruction-planner.js";
import { resolveIconFrameId } from "../icon-resolve.js";
import type { SignalId } from "../types/blueprint.js";
import {
  compareDrawCmd,
  RENDER_LAYERS,
  type DrawList,
  type IconCmd,
  type TextCmd,
} from "../types/draw-list.js";
import type { RenderDb } from "../types/render-db.js";
import { expandBounds, includeCmdBounds } from "./bounds.js";

/** Columns in the Factorio-style deconstruction planner filter grids. */
export const DECONSTRUCTION_PLANNER_COLUMNS = 12;

/** Icon used when `trees_and_rocks_only` is set (Factorio deconstruction alternative). */
export const TREES_AND_ROCKS_ICON_KEY = "entity/tree-01";

const OUTER_PAD = 1;
const ICON_GAP = 0;
const ICON_SIZE = 1;
/** One full tile row for a section header so icon grids stay on integer tiles. */
const HEADER_ROWS = 1;
const SECTION_GAP = 1;
const TEXT_SIZE = 0.35;
const TEXT_COLOR: [number, number, number, number] = [1, 1, 1, 0.92];
const HEADER_ENTITY = 0;

function tileCenter(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX + 0.5, y: tileY + 0.5 };
}

function occupiedRows(slotCount: number, lastIndex: number): number {
  if (lastIndex < 0) return 0;
  return Math.floor(lastIndex / slotCount) + 1;
}

function lastOccupiedIndex(slots: ({ name?: string } | undefined)[]): number {
  let maxIndex = -1;
  for (let index = 0; index < slots.length; index++) {
    if (slots[index]?.name) maxIndex = index;
  }
  return maxIndex;
}

function gridWidth(): number {
  return (
    OUTER_PAD +
    DECONSTRUCTION_PLANNER_COLUMNS * ICON_SIZE +
    (DECONSTRUCTION_PLANNER_COLUMNS - 1) * ICON_GAP +
    OUTER_PAD
  );
}

function sectionBodyHeight(rows: number): number {
  if (rows === 0) return 0;
  return rows * ICON_SIZE + (rows - 1) * ICON_GAP;
}

function textCommand(text: string, x: number, y: number, entity: number, sub: number): TextCmd {
  return {
    kind: "text",
    layer: RENDER_LAYERS.icons,
    sortY: y,
    sortX: x,
    entity,
    sub,
    text,
    x,
    y,
    size: TEXT_SIZE,
    color: TEXT_COLOR,
    align: "left",
    baseline: "middle",
  };
}

function entityIconCommand(
  db: RenderDb,
  filter: DeconstructionEntityFilter,
  x: number,
  y: number,
  entity: number,
  sub: number,
): IconCmd | undefined {
  const signal: SignalId = {
    name: filter.name!,
    type: filter.type ?? "entity",
    ...(typeof filter.quality === "string" && filter.quality !== "normal"
      ? { quality: filter.quality }
      : {}),
  };
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

function tileIconCommand(
  db: RenderDb,
  filter: DeconstructionTileFilter,
  x: number,
  y: number,
  entity: number,
  sub: number,
): IconCmd | undefined {
  const frame = resolveIconFrameId(db, `tile/${filter.name}`) ?? db.icons["utility/missing-icon"];
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

function treeIconCommand(db: RenderDb, x: number, y: number): IconCmd | undefined {
  const frame =
    db.icons[TREES_AND_ROCKS_ICON_KEY] ??
    altSignalFrame(db, { name: "tree-01", type: "entity" }) ??
    db.icons["utility/missing-icon"];
  if (frame === undefined) return undefined;
  return {
    kind: "icon",
    layer: RENDER_LAYERS.icons,
    sortY: y,
    sortX: x,
    entity: 1,
    sub: 0,
    frame,
    x,
    y,
    size: ICON_SIZE,
  };
}

function pushIconGrid(
  commands: (IconCmd | TextCmd)[],
  bounds: DrawList["bounds"],
  db: RenderDb,
  slots: (DeconstructionEntityFilter | DeconstructionTileFilter | undefined)[],
  rows: number,
  originY: number,
  kind: "entity" | "tile",
): DrawList["bounds"] {
  let nextBounds = bounds;
  const colStride = ICON_SIZE + ICON_GAP;
  const rowStride = ICON_SIZE + ICON_GAP;
  const slotLimit = Math.min(slots.length, rows * DECONSTRUCTION_PLANNER_COLUMNS);

  for (let index = 0; index < slotLimit; index++) {
    const filter = slots[index];
    if (!filter?.name) continue;
    const col = index % DECONSTRUCTION_PLANNER_COLUMNS;
    const row = Math.floor(index / DECONSTRUCTION_PLANNER_COLUMNS);
    // originY is an integer tile row; centers land on *.5.
    const pos = tileCenter(OUTER_PAD + col * colStride, originY + row * rowStride);
    const entity = (kind === "entity" ? 1000 : 2000) + index + 1;
    const cmd =
      kind === "entity"
        ? entityIconCommand(db, filter as DeconstructionEntityFilter, pos.x, pos.y, entity, 0)
        : tileIconCommand(db, filter as DeconstructionTileFilter, pos.x, pos.y, entity, 0);
    if (!cmd) continue;
    commands.push(cmd);
    nextBounds = includeCmdBounds(nextBounds, cmd, db.frames);
  }
  return nextBounds;
}

function pushSection(
  commands: (IconCmd | TextCmd)[],
  bounds: DrawList["bounds"],
  db: RenderDb,
  header: string,
  headerSub: number,
  slots: (DeconstructionEntityFilter | DeconstructionTileFilter | undefined)[],
  rows: number,
  cursorY: number,
  kind: "entity" | "tile",
): { bounds: DrawList["bounds"]; nextY: number } {
  const headerCmd = textCommand(header, OUTER_PAD, cursorY + 0.5, HEADER_ENTITY, headerSub);
  commands.push(headerCmd);
  let nextBounds = includeCmdBounds(bounds, headerCmd);
  const gridY = cursorY + HEADER_ROWS;
  nextBounds = pushIconGrid(commands, nextBounds, db, slots, rows, gridY, kind);
  const nextY = gridY + sectionBodyHeight(rows);
  return { bounds: nextBounds, nextY };
}

/**
 * Plan a Factorio-style deconstruction planner window as a draw list.
 * Empty entity/tile sections are omitted. `trees_and_rocks_only` renders a
 * single tree icon + label (no filter grids). Icon centers snap to the tile grid.
 */
export function planDeconstructionPlannerDrawList(
  planner: Record<string, unknown> | DeconstructionPlanner,
  db: RenderDb,
): DrawList {
  const treesOnly = deconstructionTreesAndRocksOnly(planner);
  const width = gridWidth();
  const commands: (IconCmd | TextCmd)[] = [];

  if (treesOnly) {
    const height = OUTER_PAD + ICON_SIZE + OUTER_PAD;
    let bounds: DrawList["bounds"] = { minX: 0, minY: 0, maxX: width, maxY: height };
    const iconPos = tileCenter(OUTER_PAD, OUTER_PAD);
    const treeCmd = treeIconCommand(db, iconPos.x, iconPos.y);
    if (treeCmd) {
      commands.push(treeCmd);
      bounds = includeCmdBounds(bounds, treeCmd, db.frames);
    }
    const label = textCommand(
      "Trees/rocks only",
      OUTER_PAD + ICON_SIZE + ICON_GAP,
      OUTER_PAD + 0.5,
      HEADER_ENTITY,
      0,
    );
    commands.push(label);
    bounds = includeCmdBounds(bounds, label);
    bounds = expandBounds(bounds, 0, 0, width, height);
    commands.sort(compareDrawCmd);
    return { schema: 1, bounds, commands };
  }

  const entitySlots = deconstructionEntityFilters(planner);
  const tileSlots = deconstructionTileFilters(planner);
  const entityRows = occupiedRows(DECONSTRUCTION_PLANNER_COLUMNS, lastOccupiedIndex(entitySlots));
  const tileRows = occupiedRows(DECONSTRUCTION_PLANNER_COLUMNS, lastOccupiedIndex(tileSlots));
  const showEntities = entityRows > 0;
  const showTiles = tileRows > 0;

  if (!showEntities && !showTiles) {
    const height = OUTER_PAD * 2;
    return {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
      commands: [],
    };
  }

  const entityMode = formatDeconstructionFilterMode(deconstructionEntityFilterMode(planner));
  const tileMode = formatDeconstructionFilterMode(deconstructionTileFilterMode(planner));
  const tileSelection = formatDeconstructionTileSelectionMode(
    deconstructionTileSelectionMode(planner),
  );

  let cursorY = OUTER_PAD;
  let bounds: DrawList["bounds"] = { minX: 0, minY: 0, maxX: width, maxY: OUTER_PAD };

  if (showEntities) {
    const section = pushSection(
      commands,
      bounds,
      db,
      `Entities / ${entityMode}`,
      0,
      entitySlots,
      entityRows,
      cursorY,
      "entity",
    );
    bounds = section.bounds;
    cursorY = section.nextY;
    if (showTiles) cursorY += SECTION_GAP;
  }

  if (showTiles) {
    const section = pushSection(
      commands,
      bounds,
      db,
      `Tiles / ${tileMode} / ${tileSelection}`,
      1,
      tileSlots,
      tileRows,
      cursorY,
      "tile",
    );
    bounds = section.bounds;
    cursorY = section.nextY;
  }

  const height = cursorY + OUTER_PAD;
  bounds = expandBounds(bounds, 0, 0, width, height);
  commands.sort(compareDrawCmd);
  return { schema: 1, bounds, commands };
}
