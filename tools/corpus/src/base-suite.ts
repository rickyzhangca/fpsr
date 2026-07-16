import type {
  Blueprint,
  BlueprintBook,
  BlueprintDocument,
  BlueprintEntity,
  DrawCmd,
  EntityRenderDef,
  FrameMeta,
  Icon,
  LayerGroup,
  Position,
  RenderDb,
  Tile,
} from "fpsr";
import { planDrawList } from "fpsr";
import {
  BASE_DIRECTION_16_ENTITIES,
  BASE_DIRECTION_8_ENTITIES,
  BASE_ENTITY_GROUPS,
  BASE_ENTITY_NAMES,
  BASE_GAME_VERSION,
  BASE_ORIENTATION_64_ENTITIES,
  BASE_TILE_NAMES,
  type BaseEntityGroupId,
} from "./base-game-catalog.js";

const BLUEPRINT_VERSION = 2 * 2 ** 48 + 1 * 2 ** 32 + 11 * 2 ** 16;
const CELLS_PER_PAGE = 12;
const CASES_PER_ROW = 4;
const CASE_GAP_TILES = 1;
const CROP_MARGIN_TILES = CASE_GAP_TILES / 2;

const CARDINAL_DIRECTIONS = [0, 4, 8, 12] as const;
const DIRECTIONS_8 = [0, 2, 4, 6, 8, 10, 12, 14] as const;
const DIRECTIONS_16 = Array.from({ length: 16 }, (_, index) => index);
const ORIENTATIONS_64 = Array.from({ length: 64 }, (_, index) => index / 64);

const SIDES = ["north", "east", "south", "west"] as const;
type Side = (typeof SIDES)[number];
export type BeltNeighborState = "absent" | "inbound" | "outbound";

const SIDE_OFFSETS: Record<Side, Position> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

const INBOUND_DIRECTIONS: Record<Side, number> = {
  north: 8,
  east: 12,
  south: 0,
  west: 4,
};

const OUTBOUND_DIRECTIONS: Record<Side, number> = {
  north: 0,
  east: 4,
  south: 8,
  west: 12,
};

const ENTITY_GROUP_ICON_NAMES: Record<BaseEntityGroupId, string[]> = {
  logistics: ["transport-belt", "bulk-inserter"],
  production: ["assembling-machine-3", "rocket-silo"],
  "fluids-heat": ["pipe", "nuclear-reactor"],
  power: ["substation", "solar-panel"],
  circuit: ["arithmetic-combinator", "display-panel"],
  defense: ["gun-turret", "stone-wall"],
  rail: ["rail", "rail-signal"],
  vehicles: ["car", "spidertron"],
  internal: ["loader", "infinity-chest"],
};

export type BaseSuiteCaseKind =
  | "entity-pose"
  | "adjacency-mask"
  | "belt-neighborhood"
  | "tile-patch";

export interface BaseSuiteCell {
  id: string;
  caseKind: BaseSuiteCaseKind;
  pageId: string;
  pagePath: number[];
  cropTiles: { left: number; top: number; right: number; bottom: number };
  focusEntityNumbers: number[];
  entityName?: string;
  tileName?: string;
  pose?: {
    axis: "single" | "direction" | "orientation";
    metadataSource: "base-suite-contract" | "base-only-render-db";
    direction?: number;
    orientation?: number;
    type?: "input" | "output";
  };
  adjacency?: {
    mask: number;
    sides: Side[];
  };
  beltNeighborhood?: {
    centerDirection: number;
    sides: Record<Side, BeltNeighborState>;
  };
  tilePatch?: { width: number; height: number };
}

export interface BaseSuitePage {
  id: string;
  label: string;
  sectionId: string;
  groupId: string;
  path: number[];
  cellIds: string[];
  entityCount: number;
  tileCount: number;
}

export interface BaseSuiteManifest {
  schema: 1;
  suiteId: "base-game-2.1.11";
  gameVersion: typeof BASE_GAME_VERSION;
  requiredMods: ["base"];
  inventory: {
    source: "curated-base-2.1.11-catalog";
    entityCount: number;
    tileCount: number;
    entityGroups: Record<BaseEntityGroupId, readonly string[]>;
    tiles: readonly string[];
  };
  renderMetadata: {
    role: "exact-base-graphics-and-pose-metadata";
    gameVersion: string;
    mods: string[];
    baseOnly: true;
  };
  referenceOracle: {
    status: "local-capture-required";
    reason: string;
  };
  contract: {
    covered: string[];
    deferred: string[];
  };
  coverage: {
    entityPrototypeCount: number;
    entityPoseCaseCount: number;
    adjacencyMaskCaseCount: number;
    beltNeighborhoodCaseCount: number;
    tileCaseCount: number;
    pageCount: number;
  };
  pages: BaseSuitePage[];
  cells: BaseSuiteCell[];
}

export interface BaseSuiteBuild {
  document: BlueprintDocument;
  manifest: BaseSuiteManifest;
}

interface PlacementContext {
  center: Position;
  entity: (name: string, offset?: Position, fields?: Partial<BlueprintEntity>) => BlueprintEntity;
}

interface CasePlacement {
  entities?: BlueprintEntity[];
  tiles?: Tile[];
  focusEntityNumbers?: number[];
}

interface CaseSpec {
  id: string;
  caseKind: BaseSuiteCaseKind;
  entityName?: string;
  tileName?: string;
  pose?: BaseSuiteCell["pose"];
  adjacency?: BaseSuiteCell["adjacency"];
  beltNeighborhood?: BaseSuiteCell["beltNeighborhood"];
  tilePatch?: BaseSuiteCell["tilePatch"];
  place(context: PlacementContext): CasePlacement;
}

interface PageDraft {
  id: string;
  label: string;
  sectionId: string;
  groupId: string;
  blueprint: Blueprint;
  cells: BaseSuiteCell[];
}

interface GroupDraft {
  id: string;
  label: string;
  icons: Icon[];
  pages: PageDraft[];
}

interface SectionDraft {
  id: string;
  label: string;
  icons: Icon[];
  groups: GroupDraft[];
}

interface CaseBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MaterializedCase {
  spec: CaseSpec;
  placement: CasePlacement;
  bounds: CaseBounds;
  lattice: { x: 0 | 0.5; y: 0 | 0.5 };
}

function slugPart(value: string | number): string {
  return String(value).padStart(2, "0");
}

function itemIcons(...names: string[]): Icon[] {
  return names.slice(0, 4).map((name, index) => ({
    index: index + 1,
    signal: { type: "item", name },
  }));
}

function includeBounds(current: CaseBounds | null, next: CaseBounds): CaseBounds {
  if (!current) return next;
  return {
    left: Math.min(current.left, next.left),
    top: Math.min(current.top, next.top),
    right: Math.max(current.right, next.right),
    bottom: Math.max(current.bottom, next.bottom),
  };
}

function cleanCoordinate(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function entityBounds(entity: BlueprintEntity, def: EntityRenderDef): CaseBounds {
  const [[left, top], [right, bottom]] = def.selectionBox;
  const angle =
    entity.orientation != null
      ? entity.orientation * Math.PI * 2
      : ((entity.direction ?? 0) / 16) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let bounds: CaseBounds | null = null;
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
): CaseBounds {
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

function commandVisualBounds(command: DrawCmd, frames: FrameMeta[]): CaseBounds | null {
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

function placementBounds(placement: CasePlacement, renderDb: RenderDb): CaseBounds {
  let bounds: CaseBounds | null = null;
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

function placementLattice(
  placement: CasePlacement,
  renderDb: RenderDb,
): MaterializedCase["lattice"] {
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

function materializeCase(spec: CaseSpec, renderDb: RenderDb): MaterializedCase {
  let nextEntityNumber = 1;
  const placement = spec.place({
    center: { x: 0, y: 0 },
    entity: (name, offsetPosition = { x: 0, y: 0 }, fields = {}) => ({
      entity_number: nextEntityNumber++,
      name,
      position: offsetPosition,
      ...fields,
    }),
  });
  return {
    spec,
    placement,
    bounds: placementBounds(placement, renderDb),
    lattice: placementLattice(placement, renderDb),
  };
}

/** Smallest lattice-aligned translation that keeps a local bound at or after `minimum`. */
function packedTranslation(minimum: number, localBound: number, fraction: 0 | 0.5): number {
  return Math.ceil(minimum - localBound - fraction - Number.EPSILON * 8) + fraction;
}

function maxIndexing(def: EntityRenderDef): LayerGroup["indexing"] {
  const rank: Record<LayerGroup["indexing"], number> = {
    single: 0,
    resolver: 1,
    direction4: 2,
    direction8: 3,
    direction16: 4,
  };
  let best: LayerGroup["indexing"] = "single";
  for (const group of def.graphics) {
    if (rank[group.indexing] > rank[best]) best = group.indexing;
  }

  if (
    def.kind === "belt" ||
    def.kind === "underground-belt" ||
    def.kind === "loader" ||
    def.kind === "splitter" ||
    def.kind === "inserter" ||
    def.kind === "assembler" ||
    def.kind === "gate"
  ) {
    return "direction4";
  }
  if (best === "resolver") return "direction4";
  return best;
}

function posesForEntity(name: string, def: EntityRenderDef): NonNullable<CaseSpec["pose"]>[] {
  const types: Array<"input" | "output" | undefined> =
    def.kind === "underground-belt" || def.kind === "loader" ? ["input", "output"] : [undefined];

  if (BASE_ORIENTATION_64_ENTITIES.has(name)) {
    return ORIENTATIONS_64.map((orientation) => ({
      axis: "orientation",
      metadataSource: "base-suite-contract",
      orientation,
    }));
  }

  let directions: readonly number[];
  let metadataSource: NonNullable<CaseSpec["pose"]>["metadataSource"];
  if (BASE_DIRECTION_16_ENTITIES.has(name)) {
    directions = DIRECTIONS_16;
    metadataSource = "base-suite-contract";
  } else if (BASE_DIRECTION_8_ENTITIES.has(name)) {
    directions = DIRECTIONS_8;
    metadataSource = "base-suite-contract";
  } else {
    metadataSource = "base-only-render-db";
    switch (maxIndexing(def)) {
      case "direction16":
        directions = DIRECTIONS_16;
        break;
      case "direction8":
        directions = DIRECTIONS_8;
        break;
      case "direction4":
        directions = CARDINAL_DIRECTIONS;
        break;
      default:
        directions = [0];
        break;
    }
  }

  return directions.flatMap((direction) =>
    types.map((type) => ({
      axis: directions.length === 1 ? "single" : "direction",
      metadataSource,
      direction,
      ...(type ? { type } : {}),
    })),
  );
}

function poseCase(name: string, pose: NonNullable<CaseSpec["pose"]>): CaseSpec {
  const poseId =
    pose.axis === "orientation"
      ? `o${slugPart(Math.round((pose.orientation ?? 0) * 64))}`
      : `d${slugPart(pose.direction ?? 0)}`;
  const typeId = pose.type ? `-${pose.type}` : "";
  return {
    id: `pose/${name}/${poseId}${typeId}`,
    caseKind: "entity-pose",
    entityName: name,
    pose,
    place: ({ entity }) => {
      const placed = entity(name, undefined, {
        ...(pose.axis === "orientation" ? { orientation: pose.orientation } : {}),
        ...(pose.direction != null ? { direction: pose.direction } : {}),
        ...(pose.type ? { type: pose.type } : {}),
      });
      return { entities: [placed], focusEntityNumbers: [placed.entity_number] };
    },
  };
}

function adjacencyCases(name: string): CaseSpec[] {
  return Array.from({ length: 16 }, (_, mask) => {
    const connectedSides = SIDES.filter((_, index) => (mask & (1 << index)) !== 0);
    return {
      id: `connectivity/${name}/mask-${mask.toString(16).padStart(2, "0")}`,
      caseKind: "adjacency-mask" as const,
      entityName: name,
      adjacency: { mask, sides: connectedSides },
      place: ({ entity }) => {
        const center = entity(name);
        const neighbors = connectedSides.map((side) => entity(name, SIDE_OFFSETS[side]));
        return {
          entities: [center, ...neighbors],
          focusEntityNumbers: [center.entity_number],
        };
      },
    };
  });
}

function decodeNeighborStates(index: number): Record<Side, BeltNeighborState> {
  const values: BeltNeighborState[] = ["absent", "inbound", "outbound"];
  let value = index;
  const result = {} as Record<Side, BeltNeighborState>;
  for (const side of SIDES) {
    result[side] = values[value % values.length] ?? "absent";
    value = Math.floor(value / values.length);
  }
  return result;
}

function beltNeighborhoodCases(name: string): CaseSpec[] {
  return CARDINAL_DIRECTIONS.flatMap((centerDirection) =>
    Array.from({ length: 3 ** SIDES.length }, (_, neighborhoodIndex) => {
      const sides = decodeNeighborStates(neighborhoodIndex);
      return {
        id: `connectivity/${name}/d${slugPart(centerDirection)}/n${String(neighborhoodIndex).padStart(2, "0")}`,
        caseKind: "belt-neighborhood" as const,
        entityName: name,
        beltNeighborhood: { centerDirection, sides },
        place: ({ entity }) => {
          const center = entity(name, undefined, { direction: centerDirection });
          const neighbors = SIDES.flatMap((side) => {
            const state = sides[side];
            if (state === "absent") return [];
            const direction =
              state === "inbound" ? INBOUND_DIRECTIONS[side] : OUTBOUND_DIRECTIONS[side];
            return [entity(name, SIDE_OFFSETS[side], { direction })];
          });
          return {
            entities: [center, ...neighbors],
            focusEntityNumbers: [center.entity_number],
          };
        },
      };
    }),
  );
}

function tileCase(name: string): CaseSpec {
  const width = 7;
  const height = 7;
  return {
    id: `tile/${name}`,
    caseKind: "tile-patch",
    tileName: name,
    tilePatch: { width, height },
    place: ({ center }) => {
      const tiles: Tile[] = [];
      const left = Math.floor(center.x - width / 2);
      const top = Math.floor(center.y - height / 2);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          tiles.push({ name, position: { x: left + x, y: top + y } });
        }
      }
      return { tiles };
    },
  };
}

function buildPages(
  renderDb: RenderDb,
  sectionId: string,
  groupId: string,
  groupLabel: string,
  pageIcons: Icon[],
  cases: CaseSpec[],
): PageDraft[] {
  const pages: PageDraft[] = [];
  for (let offset = 0; offset < cases.length; offset += CELLS_PER_PAGE) {
    const pageCases = cases.slice(offset, offset + CELLS_PER_PAGE);
    const pageNumber = pages.length + 1;
    const pageId = `${sectionId}/${groupId}/page-${String(pageNumber).padStart(3, "0")}`;
    const entities: BlueprintEntity[] = [];
    const tiles: Tile[] = [];
    const cells: BaseSuiteCell[] = [];
    let nextEntityNumber = 1;
    const materialized = pageCases.map((testCase) => materializeCase(testCase, renderDb));
    let rowTop = 0;

    for (let rowOffset = 0; rowOffset < materialized.length; rowOffset += CASES_PER_ROW) {
      const row = materialized.slice(rowOffset, rowOffset + CASES_PER_ROW);
      let previousRight: number | null = null;
      let rowBottom = rowTop;

      for (const testCase of row) {
        const minimumLeft = previousRight == null ? 0 : previousRight + CASE_GAP_TILES;
        const translateX = packedTranslation(minimumLeft, testCase.bounds.left, testCase.lattice.x);
        const translateY = packedTranslation(rowTop, testCase.bounds.top, testCase.lattice.y);
        const placedBounds = {
          left: testCase.bounds.left + translateX,
          top: testCase.bounds.top + translateY,
          right: testCase.bounds.right + translateX,
          bottom: testCase.bounds.bottom + translateY,
        };
        previousRight = placedBounds.right;
        rowBottom = Math.max(rowBottom, placedBounds.bottom);

        const numberMap = new Map<number, number>();
        for (const entity of testCase.placement.entities ?? []) {
          const entityNumber = nextEntityNumber++;
          numberMap.set(entity.entity_number, entityNumber);
          entities.push({
            ...entity,
            entity_number: entityNumber,
            position: {
              x: entity.position.x + translateX,
              y: entity.position.y + translateY,
            },
          });
        }
        for (const tile of testCase.placement.tiles ?? []) {
          tiles.push({
            ...tile,
            position: {
              x: tile.position.x + translateX,
              y: tile.position.y + translateY,
            },
          });
        }

        const spec = testCase.spec;
        cells.push({
          id: spec.id,
          caseKind: spec.caseKind,
          pageId,
          pagePath: [],
          cropTiles: {
            left: placedBounds.left - CROP_MARGIN_TILES,
            top: placedBounds.top - CROP_MARGIN_TILES,
            right: placedBounds.right + CROP_MARGIN_TILES,
            bottom: placedBounds.bottom + CROP_MARGIN_TILES,
          },
          focusEntityNumbers: (testCase.placement.focusEntityNumbers ?? []).flatMap(
            (entityNumber) => {
              const mapped = numberMap.get(entityNumber);
              return mapped == null ? [] : [mapped];
            },
          ),
          ...(spec.entityName ? { entityName: spec.entityName } : {}),
          ...(spec.tileName ? { tileName: spec.tileName } : {}),
          ...(spec.pose ? { pose: spec.pose } : {}),
          ...(spec.adjacency ? { adjacency: spec.adjacency } : {}),
          ...(spec.beltNeighborhood ? { beltNeighborhood: spec.beltNeighborhood } : {}),
          ...(spec.tilePatch ? { tilePatch: spec.tilePatch } : {}),
        });
      }

      rowTop = rowBottom + CASE_GAP_TILES;
    }

    const start = offset + 1;
    const end = offset + pageCases.length;
    const label = `${String(pageNumber).padStart(3, "0")} · ${groupLabel} ${String(start).padStart(3, "0")}–${String(end).padStart(3, "0")}`;
    pages.push({
      id: pageId,
      label,
      sectionId,
      groupId,
      cells,
      blueprint: {
        item: "blueprint",
        label,
        icons: pageIcons,
        description: `Generated FPSR visual test page. Cases: ${start}–${end}.`,
        version: BLUEPRINT_VERSION,
        ...(entities.length > 0 ? { entities } : {}),
        ...(tiles.length > 0 ? { tiles } : {}),
      },
    });
  }
  return pages;
}

function group(
  renderDb: RenderDb,
  sectionId: string,
  id: string,
  label: string,
  icons: Icon[],
  cases: CaseSpec[],
): GroupDraft {
  return { id, label, icons, pages: buildPages(renderDb, sectionId, id, label, icons, cases) };
}

function makeBook(
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

function sectionBook(section: SectionDraft): BlueprintBook {
  return makeBook(
    section.label,
    section.icons,
    section.groups.map((entry, groupIndex) => ({
      index: groupIndex,
      blueprint_book: makeBook(
        entry.label,
        entry.icons,
        entry.pages.map((page, pageIndex) => ({ index: pageIndex, blueprint: page.blueprint })),
      ),
    })),
  );
}

function entityCases(
  renderDb: RenderDb,
  groupId: BaseEntityGroupId,
): { cases: CaseSpec[]; missing: string[] } {
  const cases: CaseSpec[] = [];
  const missing: string[] = [];
  for (const name of BASE_ENTITY_GROUPS[groupId]) {
    const def = renderDb.entities[name];
    if (!def) {
      missing.push(name);
      continue;
    }
    for (const pose of posesForEntity(name, def)) cases.push(poseCase(name, pose));
  }
  return { cases, missing };
}

function assertRenderMetadataCoverage(renderDb: RenderDb): void {
  if (renderDb.gameVersion !== BASE_GAME_VERSION || renderDb.mods.join(",") !== "base") {
    throw new Error(
      `Base suite requires the exact ${BASE_GAME_VERSION} [base] render DB; got ` +
        `${renderDb.gameVersion} [${renderDb.mods.join(", ")}]`,
    );
  }
  const missingEntities = BASE_ENTITY_NAMES.filter((name) => renderDb.entities[name] == null);
  const missingTiles = BASE_TILE_NAMES.filter((name) => renderDb.tiles[name] == null);
  if (missingEntities.length > 0 || missingTiles.length > 0) {
    throw new Error(
      [
        missingEntities.length > 0 ? `entities: ${missingEntities.join(", ")}` : "",
        missingTiles.length > 0 ? `tiles: ${missingTiles.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

export function buildBaseSuite(renderDb: RenderDb): BaseSuiteBuild {
  assertRenderMetadataCoverage(renderDb);

  const poseGroups = (
    ["logistics", "production", "fluids-heat", "power", "circuit", "defense"] as const
  ).map((groupId) => {
    const { cases } = entityCases(renderDb, groupId);
    return group(
      renderDb,
      "entity-poses",
      groupId,
      groupId,
      itemIcons(...ENTITY_GROUP_ICON_NAMES[groupId]),
      cases,
    );
  });
  const railCases = entityCases(renderDb, "rail").cases;
  const vehicleCases = entityCases(renderDb, "vehicles").cases;
  const internalCases = entityCases(renderDb, "internal").cases;

  const sections: SectionDraft[] = [
    {
      id: "entity-poses",
      label: "10 · Entity poses",
      icons: itemIcons("assembling-machine-3", "transport-belt"),
      groups: poseGroups,
    },
    {
      id: "connectivity",
      label: "20 · Connectivity",
      icons: itemIcons("pipe", "transport-belt"),
      groups: [
        group(
          renderDb,
          "connectivity",
          "pipe",
          "pipe · 16 masks",
          itemIcons("pipe"),
          adjacencyCases("pipe"),
        ),
        group(
          renderDb,
          "connectivity",
          "heat-pipe",
          "heat pipe · 16 masks",
          itemIcons("heat-pipe"),
          adjacencyCases("heat-pipe"),
        ),
        group(
          renderDb,
          "connectivity",
          "stone-wall",
          "stone wall · 16 masks",
          itemIcons("stone-wall"),
          adjacencyCases("stone-wall"),
        ),
        ...["transport-belt", "fast-transport-belt", "express-transport-belt"].map((name) =>
          group(
            renderDb,
            "connectivity",
            name,
            `${name} · 4 × 3⁴ neighborhoods`,
            itemIcons(name),
            beltNeighborhoodCases(name),
          ),
        ),
      ],
    },
    {
      id: "rail",
      label: "30 · Rail",
      icons: itemIcons(...ENTITY_GROUP_ICON_NAMES.rail),
      groups: [
        group(
          renderDb,
          "rail",
          "rail",
          "rail poses",
          itemIcons(...ENTITY_GROUP_ICON_NAMES.rail),
          railCases,
        ),
      ],
    },
    {
      id: "vehicles",
      label: "40 · Vehicles & orientation",
      icons: itemIcons(...ENTITY_GROUP_ICON_NAMES.vehicles),
      groups: [
        group(
          renderDb,
          "vehicles",
          "vehicles",
          "vehicle orientations",
          itemIcons(...ENTITY_GROUP_ICON_NAMES.vehicles),
          vehicleCases,
        ),
      ],
    },
    {
      id: "internal",
      label: "90 · Internal & legacy",
      icons: itemIcons(...ENTITY_GROUP_ICON_NAMES.internal),
      groups: [
        group(
          renderDb,
          "internal",
          "internal",
          "internal & legacy poses",
          itemIcons(...ENTITY_GROUP_ICON_NAMES.internal),
          internalCases,
        ),
      ],
    },
    {
      id: "tiles",
      label: "99 · Tiles",
      icons: itemIcons("concrete", "landfill"),
      groups: [
        group(
          renderDb,
          "tiles",
          "base-tiles",
          "base tile patches",
          itemIcons("concrete", "landfill"),
          BASE_TILE_NAMES.map(tileCase),
        ),
      ],
    },
  ];

  const pages: BaseSuitePage[] = [];
  const cells: BaseSuiteCell[] = [];
  sections.forEach((section, sectionIndex) => {
    section.groups.forEach((entry, groupIndex) => {
      entry.pages.forEach((page, pageIndex) => {
        const path = [sectionIndex, groupIndex, pageIndex];
        for (const cell of page.cells) cell.pagePath = path;
        pages.push({
          id: page.id,
          label: page.label,
          sectionId: page.sectionId,
          groupId: page.groupId,
          path,
          cellIds: page.cells.map((cell) => cell.id),
          entityCount: page.blueprint.entities?.length ?? 0,
          tileCount: page.blueprint.tiles?.length ?? 0,
        });
        cells.push(...page.cells);
      });
    });
  });

  const document: BlueprintDocument = {
    blueprint_book: makeBook(
      `Base game ${BASE_GAME_VERSION}`,
      itemIcons("assembling-machine-3", "transport-belt", "rail", "concrete"),
      sections.map((section, sectionIndex) => ({
        index: sectionIndex,
        blueprint_book: sectionBook(section),
      })),
    ),
  };

  const manifest: BaseSuiteManifest = {
    schema: 1,
    suiteId: "base-game-2.1.11",
    gameVersion: BASE_GAME_VERSION,
    requiredMods: ["base"],
    inventory: {
      source: "curated-base-2.1.11-catalog",
      entityCount: BASE_ENTITY_NAMES.length,
      tileCount: BASE_TILE_NAMES.length,
      entityGroups: BASE_ENTITY_GROUPS,
      tiles: BASE_TILE_NAMES,
    },
    renderMetadata: {
      role: "exact-base-graphics-and-pose-metadata",
      gameVersion: renderDb.gameVersion,
      mods: [...renderDb.mods],
      baseOnly: true,
    },
    referenceOracle: {
      status: "local-capture-required",
      reason:
        "Exact Base metadata is committed, but real-game PNG references are generated locally and intentionally not committed.",
    },
    contract: {
      covered: [
        "Every curated Base 2.1.11 entity prototype, including hidden/internal and legacy prototypes",
        "All declared 16-way, 8-way, cardinal, and 64-step orientation poses",
        "Every N/E/S/W adjacency mask for pipe, heat-pipe, and stone-wall",
        "Every four-neighbor absent/inbound/outbound state for all three Base belt tiers and four center directions",
        "A 7×7 patch for every curated Base tile",
        "Cases packed from pose-specific non-shadow sprite/tile bounds with one empty tile between neighboring cases",
      ],
      deferred: [
        "Powered, animated, crafting, fluid-level, gate-open, turret-aim, and other runtime states",
        "Arbitrary circuit networks, wire topologies, inventories, recipes, modules, filters, schedules, and train consists",
        "Combinatorial neighbor states outside the explicit pipe, heat-pipe, wall, and belt matrices",
        "Pixel correctness on machines where the exact Factorio 2.1.11 Base reference set has not been captured",
      ],
    },
    coverage: {
      entityPrototypeCount: BASE_ENTITY_NAMES.length,
      entityPoseCaseCount: cells.filter((cell) => cell.caseKind === "entity-pose").length,
      adjacencyMaskCaseCount: cells.filter((cell) => cell.caseKind === "adjacency-mask").length,
      beltNeighborhoodCaseCount: cells.filter((cell) => cell.caseKind === "belt-neighborhood")
        .length,
      tileCaseCount: cells.filter((cell) => cell.caseKind === "tile-patch").length,
      pageCount: pages.length,
    },
    pages,
    cells,
  };

  return { document, manifest };
}
