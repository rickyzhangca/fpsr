import type {
  Blueprint,
  BlueprintBook,
  BlueprintDocument,
  BlueprintEntity,
  DrawCmd,
  EntityRenderDef,
  FrameMeta,
  Icon,
  Position,
  RenderDb,
  Tile,
} from "fpsr";
import { planDrawList } from "fpsr";
import {
  BASE_DIRECTION_16_ENTITIES,
  BASE_DIRECTION_8_ENTITIES,
  BASE_ENTITY_NAMES,
  BASE_GAME_BOOK_SPEC,
  BASE_GAME_VERSION,
  BASE_ORIENTATION_64_ENTITIES,
  BASE_TILE_NAMES,
  baseGamePageSpec,
  baseGameRootBookSpec,
  type BaseGameBookSpec,
  type BaseGamePageSpec,
} from "./base-game-book-spec.js";
import {
  CARDINAL_DIRECTIONS,
  DIRECTIONS_16,
  poseCellId,
  posesForEntity,
  type EntityPose,
} from "./entity-poses.js";

const BLUEPRINT_VERSION = 2 * 2 ** 48 + 1 * 2 ** 32 + 11 * 2 ** 16;
const CASES_PER_ROW = 4;
const CASE_GAP_TILES = 1;
const CROP_MARGIN_TILES = CASE_GAP_TILES / 2;

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
  pose?: EntityPose;
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
  canaryPageIds: string[];
  inventory: {
    source: "base-game-book-spec";
    specId: typeof BASE_GAME_BOOK_SPEC.id;
    entityCount: number;
    tileCount: number;
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
  entries: GroupBookEntry[];
}

type GroupBookEntry =
  | { kind: "page"; page: PageDraft }
  | { kind: "book"; id: string; label: string; icons: Icon[]; pages: PageDraft[] };

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

function poseCase(name: string, pose: EntityPose): CaseSpec {
  return {
    id: poseCellId(name, pose),
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

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function buildSinglePage(
  renderDb: RenderDb,
  sectionId: string,
  groupId: string,
  pageId: string,
  label: string,
  pageIcons: Icon[],
  cases: CaseSpec[],
  caseOffset: number,
  caseRows?: CaseSpec[][],
): PageDraft {
  const entities: BlueprintEntity[] = [];
  const tiles: Tile[] = [];
  const cells: BaseSuiteCell[] = [];
  let nextEntityNumber = 1;
  const rows = caseRows
    ? caseRows.map((row) => row.map((testCase) => materializeCase(testCase, renderDb)))
    : chunk(
        cases.map((testCase) => materializeCase(testCase, renderDb)),
        CASES_PER_ROW,
      );
  let rowTop = 0;

  for (const row of rows) {
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

  const start = caseOffset + 1;
  const end = caseOffset + cases.length;
  return {
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
  };
}

function pageEntities(id: string): readonly string[] {
  return baseGamePageSpec(id).entities ?? [];
}

function pageTiles(id: string): readonly string[] {
  return baseGamePageSpec(id).tiles ?? [];
}

function specIcons(spec: Pick<BaseGameBookSpec | BaseGamePageSpec, "icons">): Icon[] {
  return itemIcons(...spec.icons);
}

const CONTAINER_ENTITIES = pageEntities("entity-poses/logistics/storage");

function containerCases(renderDb: RenderDb): CaseSpec[] {
  return CONTAINER_ENTITIES.flatMap((name) => {
    if (renderDb.entities[name] == null) throw new Error(`Missing entity ${name}`);
    return CARDINAL_DIRECTIONS.map((direction) =>
      poseCase(name, {
        axis: "direction",
        metadataSource: name === "storage-tank" ? "base-only-render-db" : "base-suite-contract",
        direction,
      }),
    );
  });
}

const ROBOT_PAGE_ENTITIES = pageEntities("entity-poses/logistics/logistic-network");
const LOGISTICS_CHEST_ENTITIES = ROBOT_PAGE_ENTITIES.filter((name) => name.endsWith("-chest"));
const ROBOT_ENTITIES = ROBOT_PAGE_ENTITIES.filter((name) => name.endsWith("-robot"));

const ELECTRICITY_PAGE_ENTITIES = pageEntities(
  "entity-poses/logistics/electric-fluid-system",
).slice(0, 4);

/** Mirrors `rail/rail/page-001` and `page-002`, plus half-diagonal from `page-003` (no signals). */
const RAILS_LOGISTICS_CASE_IDS = [
  "pose/straight-rail/d00",
  "pose/straight-rail/d02",
  "pose/straight-rail/d04",
  "pose/straight-rail/d06",
  "pose/straight-rail/d08",
  "pose/straight-rail/d10",
  "pose/straight-rail/d12",
  "pose/straight-rail/d14",
  "pose/curved-rail-a/d00",
  "pose/curved-rail-a/d02",
  "pose/curved-rail-a/d04",
  "pose/curved-rail-a/d06",
  "pose/curved-rail-a/d08",
  "pose/curved-rail-a/d10",
  "pose/curved-rail-a/d12",
  "pose/curved-rail-a/d14",
  "pose/curved-rail-b/d00",
  "pose/curved-rail-b/d02",
  "pose/curved-rail-b/d04",
  "pose/curved-rail-b/d06",
  "pose/curved-rail-b/d08",
  "pose/curved-rail-b/d10",
  "pose/curved-rail-b/d12",
  "pose/curved-rail-b/d14",
  "pose/half-diagonal-rail/d00",
  "pose/half-diagonal-rail/d02",
  "pose/half-diagonal-rail/d04",
  "pose/half-diagonal-rail/d06",
  "pose/half-diagonal-rail/d08",
  "pose/half-diagonal-rail/d10",
  "pose/half-diagonal-rail/d12",
  "pose/half-diagonal-rail/d14",
] as const;

const RAILS_PAGE_ENTITIES = pageEntities("entity-poses/logistics/railway/rails");
const CIRCUIT_NETWORK_ENTITIES = pageEntities("entity-poses/logistics/circuit-network");
const LOGISTICS_TILES = pageTiles("entity-poses/logistics/terrain");

const LOGISTICS_TILE_SEGMENTS = [
  {
    id: "stone-path",
    label: "stone brick",
    icons: itemIcons("stone-brick"),
    tiles: LOGISTICS_TILES.slice(0, 1),
  },
  {
    id: "concrete",
    label: "concrete",
    icons: itemIcons("concrete"),
    tiles: LOGISTICS_TILES.slice(1, 2),
  },
  {
    id: "hazard-concrete",
    label: "hazard concrete",
    icons: itemIcons("hazard-concrete"),
    tiles: LOGISTICS_TILES.slice(2, 4),
  },
  {
    id: "refined-concrete",
    label: "refined concrete",
    icons: itemIcons("refined-concrete"),
    tiles: LOGISTICS_TILES.slice(4, 5),
  },
  {
    id: "refined-hazard-concrete",
    label: "refined hazard concrete",
    icons: itemIcons("refined-hazard-concrete"),
    tiles: LOGISTICS_TILES.slice(5, 7),
  },
  {
    id: "landfill",
    label: "landfill",
    icons: itemIcons("landfill"),
    tiles: LOGISTICS_TILES.slice(7),
  },
] as const;

function entitySubsetCases(renderDb: RenderDb, names: readonly string[]): CaseSpec[] {
  return entityCases(renderDb, names).cases;
}

function namespaceCases(cases: CaseSpec[], groupId: string, segmentId: string): CaseSpec[] {
  return cases.map((testCase) => ({
    ...testCase,
    id: `${groupId}/${segmentId}/${testCase.id}`,
  }));
}

function segmentCases(cases: CaseSpec[], segmentId: string): CaseSpec[] {
  return namespaceCases(cases, "logistics", segmentId);
}

const ELECTRICITY_ENTITIES = pageEntities("entity-poses/production/electricity");
const RESOURCE_EXTRACTION_ENTITIES = pageEntities("entity-poses/production/resource-extraction");
const FURNACE_ENTITIES = pageEntities("entity-poses/production/furnaces");
const PRODUCTION_PRINT_ENTITIES = pageEntities("entity-poses/production/production");
const MODULES_ENTITIES = pageEntities("entity-poses/production/modules");
const PLANETSIDE_ENTITIES = pageEntities("space/planetside");
const DEFENSE_PRINT_ENTITIES = pageEntities("combat-items/defense");
const TURRET_PRINT_ENTITIES = pageEntities("combat-items/turrets");

function electricityCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return ELECTRICITY_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "production", "electricity"),
  );
}

function resourceExtractionCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return RESOURCE_EXTRACTION_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "production", "resource-extraction"),
  );
}

function furnaceCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return FURNACE_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "production", "furnaces"),
  );
}

function productionPrintCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return PRODUCTION_PRINT_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "production", "production"),
  );
}

function modulesCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return MODULES_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "production", "modules"),
  );
}

function planetsideCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return PLANETSIDE_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "space", "planetside"),
  );
}

function defensePrintCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return DEFENSE_PRINT_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "combat-items", "defense"),
  );
}

function turretsCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return TURRET_PRINT_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "combat-items", "turrets"),
  );
}

function cardinalPoseCases(
  name: string,
  metadataSource: NonNullable<CaseSpec["pose"]>["metadataSource"],
): CaseSpec[] {
  return CARDINAL_DIRECTIONS.map((direction) =>
    poseCase(name, {
      axis: "direction",
      metadataSource,
      direction,
    }),
  );
}

function direction16PoseCases(
  name: string,
  metadataSource: NonNullable<CaseSpec["pose"]>["metadataSource"],
): CaseSpec[] {
  return DIRECTIONS_16.map((direction) =>
    poseCase(name, {
      axis: "direction",
      metadataSource,
      direction,
    }),
  );
}

function robotCases(renderDb: RenderDb): CaseSpec[] {
  const cases: CaseSpec[] = [];
  for (const name of ROBOT_ENTITIES) {
    if (renderDb.entities[name] == null) throw new Error(`Missing entity ${name}`);
    cases.push(...direction16PoseCases(name, "base-suite-contract"));
  }
  for (const name of LOGISTICS_CHEST_ENTITIES) {
    if (renderDb.entities[name] == null) throw new Error(`Missing entity ${name}`);
    cases.push(...cardinalPoseCases(name, "base-suite-contract"));
  }
  if (renderDb.entities.roboport == null) throw new Error("Missing entity roboport");
  cases.push(...cardinalPoseCases("roboport", "base-suite-contract"));
  return cases;
}

interface PageBuildBehavior {
  buildCases?: (renderDb: RenderDb) => CaseSpec[];
  buildCaseRows?: (renderDb: RenderDb) => CaseSpec[][];
}

function fluidCaseRows(renderDb: RenderDb, segmentId: string): CaseSpec[][] {
  const row = (names: readonly string[]) =>
    segmentCases(entitySubsetCases(renderDb, names), segmentId);
  return [row(["pipe"]), row(["pipe-to-ground"]), row(["pump"])];
}

function electricFluidSystemCaseRows(renderDb: RenderDb): CaseSpec[][] {
  const segmentId = "electric-fluid-system";
  const electricityCases = segmentCases(
    entitySubsetCases(renderDb, ELECTRICITY_PAGE_ENTITIES),
    segmentId,
  );
  return [...chunk(electricityCases, CASES_PER_ROW), ...fluidCaseRows(renderDb, segmentId)];
}

function railsCaseRows(renderDb: RenderDb): CaseSpec[][] {
  const { cases } = entityCases(renderDb, RAILS_PAGE_ENTITIES);
  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const ordered = RAILS_LOGISTICS_CASE_IDS.map((id) => {
    const testCase = byId.get(id);
    if (!testCase) throw new Error(`Missing rail case ${id}`);
    return testCase;
  });
  return chunk(segmentCases(ordered, "rails"), CASES_PER_ROW);
}

function railSignalCaseRows(renderDb: RenderDb): CaseSpec[][] {
  const cases = (names: readonly string[]) =>
    segmentCases(entitySubsetCases(renderDb, names), "rail-signals");
  return [
    ...chunk(cases(["rail-signal"]), CASES_PER_ROW),
    ...chunk(cases(["rail-chain-signal"]), CASES_PER_ROW),
  ];
}

function entityPoseCaseRows(renderDb: RenderDb, name: string, segmentId: string): CaseSpec[][] {
  return chunk(segmentCases(entitySubsetCases(renderDb, [name]), segmentId), CASES_PER_ROW);
}

function rollingStockCaseRows(renderDb: RenderDb, name: string, segmentId: string): CaseSpec[][] {
  return entityPoseCaseRows(renderDb, name, segmentId);
}

function segmentTileCases(names: readonly string[], pageIdPrefix: string): CaseSpec[] {
  return names.map((name) => ({
    ...tileCase(name),
    id: `${pageIdPrefix}/tile/${name}`,
  }));
}

function circuitNetworkCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return CIRCUIT_NETWORK_ENTITIES.map((name) =>
    segmentCases(entitySubsetCases(renderDb, [name]), "circuit-network"),
  );
}

function tilesCaseRows(): CaseSpec[][] {
  return LOGISTICS_TILE_SEGMENTS.map((segment) =>
    segmentTileCases(segment.tiles, "logistics/terrain"),
  );
}

const LOGISTICS_PAGE_BEHAVIORS: Record<string, PageBuildBehavior> = {
  "entity-poses/logistics/storage": {
    buildCases: containerCases,
  },
  "entity-poses/logistics/electric-fluid-system": {
    buildCaseRows: electricFluidSystemCaseRows,
  },
  "entity-poses/logistics/railway/rails": {
    buildCaseRows: railsCaseRows,
  },
  "entity-poses/logistics/railway/train-stop": {
    buildCases: (renderDb) =>
      segmentCases(entitySubsetCases(renderDb, ["train-stop"]), "train-stop"),
  },
  "entity-poses/logistics/railway/rail-signals": {
    buildCaseRows: railSignalCaseRows,
  },
  "entity-poses/logistics/railway/locomotive": {
    buildCaseRows: (renderDb) => rollingStockCaseRows(renderDb, "locomotive", "locomotive"),
  },
  "entity-poses/logistics/railway/cargo-wagon": {
    buildCaseRows: (renderDb) => rollingStockCaseRows(renderDb, "cargo-wagon", "cargo-wagon"),
  },
  "entity-poses/logistics/railway/fluid-wagon": {
    buildCaseRows: (renderDb) => rollingStockCaseRows(renderDb, "fluid-wagon", "fluid-wagon"),
  },
  "entity-poses/logistics/railway/artillery-wagon": {
    buildCaseRows: (renderDb) =>
      rollingStockCaseRows(renderDb, "artillery-wagon", "artillery-wagon"),
  },
  "entity-poses/logistics/transport/car": {
    buildCaseRows: (renderDb) => entityPoseCaseRows(renderDb, "car", "car"),
  },
  "entity-poses/logistics/transport/tank": {
    buildCaseRows: (renderDb) => entityPoseCaseRows(renderDb, "tank", "tank"),
  },
  "entity-poses/logistics/transport/spidertron": {
    buildCaseRows: (renderDb) => entityPoseCaseRows(renderDb, "spidertron", "spidertron"),
  },
  "entity-poses/logistics/logistic-network": {
    buildCases: robotCases,
  },
  "entity-poses/logistics/circuit-network": {
    buildCaseRows: circuitNetworkCaseRows,
  },
  "entity-poses/logistics/terrain": {
    buildCaseRows: tilesCaseRows,
  },
};

function buildLogisticsSegmentPage(
  renderDb: RenderDb,
  spec: BaseGamePageSpec,
  caseOffset: number,
): { page: PageDraft; caseCount: number } {
  const behavior = LOGISTICS_PAGE_BEHAVIORS[spec.id];
  const caseRows = behavior?.buildCaseRows?.(renderDb);
  const segmentCases = caseRows
    ? caseRows.flat()
    : behavior?.buildCases
      ? behavior.buildCases(renderDb)
      : entitySubsetCases(renderDb, spec.entities ?? []);
  return {
    page: buildSinglePage(
      renderDb,
      "entity-poses",
      "logistics",
      spec.id,
      spec.label,
      specIcons(spec),
      segmentCases,
      caseOffset,
      caseRows,
    ),
    caseCount: segmentCases.length,
  };
}

function buildFlatSpecGroup(
  renderDb: RenderDb,
  spec: BaseGameBookSpec,
  sectionId: string,
  behaviors: Record<string, PageBuildBehavior>,
): GroupDraft {
  let caseOffset = 0;
  const entries: GroupBookEntry[] = [];

  for (const entry of spec.children) {
    if (entry.kind !== "page") {
      throw new Error(`Base game book ${spec.id} only supports leaf pages here; got ${entry.id}`);
    }
    const behavior = behaviors[entry.id];
    const caseRows = behavior?.buildCaseRows?.(renderDb);
    const cases = caseRows
      ? caseRows.flat()
      : behavior?.buildCases
        ? behavior.buildCases(renderDb)
        : entitySubsetCases(renderDb, entry.entities ?? []);
    entries.push({
      kind: "page",
      page: buildSinglePage(
        renderDb,
        sectionId,
        spec.id,
        entry.id,
        entry.label,
        specIcons(entry),
        cases,
        caseOffset,
        caseRows,
      ),
    });
    caseOffset += cases.length;
  }

  return {
    id: spec.id,
    label: spec.label,
    icons: specIcons(spec),
    entries,
  };
}

const PRODUCTION_PAGE_BEHAVIORS: Record<string, PageBuildBehavior> = {
  "entity-poses/production/electricity": { buildCaseRows: electricityCaseRows },
  "entity-poses/production/resource-extraction": {
    buildCaseRows: resourceExtractionCaseRows,
  },
  "entity-poses/production/furnaces": { buildCaseRows: furnaceCaseRows },
  "entity-poses/production/production": { buildCaseRows: productionPrintCaseRows },
  "entity-poses/production/modules": { buildCaseRows: modulesCaseRows },
};

function productionGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(
    renderDb,
    baseGameRootBookSpec("production"),
    "entity-poses",
    PRODUCTION_PAGE_BEHAVIORS,
  );
}

function spaceGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(renderDb, baseGameRootBookSpec("space"), "space", {
    "space/planetside": { buildCaseRows: planetsideCaseRows },
  });
}

function combatItemsGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(renderDb, baseGameRootBookSpec("combat-items"), "combat-items", {
    "combat-items/defense": { buildCaseRows: defensePrintCaseRows },
    "combat-items/turrets": { buildCaseRows: turretsCaseRows },
  });
}

const INTERNAL_LOADER_ENTITIES = pageEntities("internal-legacy/loaders");
const INTERNAL_BELT_ENTITIES = pageEntities("internal-legacy/belts");
const INTERNAL_CONTAINER_ENTITIES = pageEntities("internal-legacy/containers");
const INTERNAL_FLUID_ENTITIES = pageEntities("internal-legacy/fluid");
const INTERNAL_INTERFACE_ENTITIES = pageEntities("internal-legacy/interfaces");
const INTERNAL_SIMPLE_ENTITIES = pageEntities("internal-legacy/simple-entities");

function internalPrintCaseRows(
  renderDb: RenderDb,
  entities: readonly string[],
  segmentId: string,
): CaseSpec[][] {
  return entities.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "internal-legacy", segmentId),
  );
}

function internalChunkedCaseRows(
  renderDb: RenderDb,
  name: string,
  segmentId: string,
): CaseSpec[][] {
  return chunk(
    namespaceCases(entitySubsetCases(renderDb, [name]), "internal-legacy", segmentId),
    CASES_PER_ROW,
  );
}

function legacyRailsCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return [
    ...internalChunkedCaseRows(renderDb, "legacy-straight-rail", "legacy-rails"),
    ...internalChunkedCaseRows(renderDb, "legacy-curved-rail", "legacy-rails"),
  ];
}

const INTERNAL_PAGE_BEHAVIORS: Record<string, PageBuildBehavior> = {
  "internal-legacy/loaders": {
    buildCaseRows: (renderDb) =>
      internalPrintCaseRows(renderDb, INTERNAL_LOADER_ENTITIES, "loaders"),
  },
  "internal-legacy/belts": {
    buildCaseRows: (renderDb) => internalPrintCaseRows(renderDb, INTERNAL_BELT_ENTITIES, "belts"),
  },
  "internal-legacy/containers": {
    buildCaseRows: (renderDb) =>
      internalPrintCaseRows(renderDb, INTERNAL_CONTAINER_ENTITIES, "containers"),
  },
  "internal-legacy/fluid": {
    buildCaseRows: (renderDb) => internalPrintCaseRows(renderDb, INTERNAL_FLUID_ENTITIES, "fluid"),
  },
  "internal-legacy/interfaces": {
    buildCaseRows: (renderDb) =>
      internalPrintCaseRows(renderDb, INTERNAL_INTERFACE_ENTITIES, "interfaces"),
  },
  "internal-legacy/infinity-cargo-wagon": {
    buildCaseRows: (renderDb) =>
      internalChunkedCaseRows(renderDb, "infinity-cargo-wagon", "infinity-cargo-wagon"),
  },
  "internal-legacy/simple-entities": {
    buildCaseRows: (renderDb) =>
      internalPrintCaseRows(renderDb, INTERNAL_SIMPLE_ENTITIES, "simple-entities"),
  },
  "internal-legacy/legacy-rails": {
    buildCaseRows: legacyRailsCaseRows,
  },
};

function internalLegacyGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(
    renderDb,
    baseGameRootBookSpec("internal-legacy"),
    "internal-legacy",
    INTERNAL_PAGE_BEHAVIORS,
  );
}

function logisticsGroup(renderDb: RenderDb): GroupDraft {
  const spec = baseGameRootBookSpec("logistics");
  const entries: GroupBookEntry[] = [];
  let caseOffset = 0;

  for (const item of spec.children) {
    if (item.kind === "page") {
      const { page, caseCount } = buildLogisticsSegmentPage(renderDb, item, caseOffset);
      entries.push({ kind: "page", page });
      caseOffset += caseCount;
      continue;
    }

    const bookPages: PageDraft[] = [];
    for (const child of item.children) {
      if (child.kind !== "page") {
        throw new Error(`Nested Base logistics book ${item.id} must contain pages`);
      }
      const { page, caseCount } = buildLogisticsSegmentPage(renderDb, child, caseOffset);
      bookPages.push(page);
      caseOffset += caseCount;
    }
    entries.push({
      kind: "book",
      id: item.id,
      label: item.label,
      icons: specIcons(item),
      pages: bookPages,
    });
  }

  return {
    id: spec.id,
    label: spec.label,
    icons: specIcons(spec),
    entries,
  };
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

function groupBookEntries(entries: GroupBookEntry[]): BlueprintBook["blueprints"] {
  return entries.map((entry, index) => {
    if (entry.kind === "page") {
      return { index, blueprint: entry.page.blueprint };
    }
    return {
      index,
      blueprint_book: makeBook(
        entry.label,
        entry.icons,
        entry.pages.map((page, pageIndex) => ({ index: pageIndex, blueprint: page.blueprint })),
      ),
    };
  });
}

function appendGroupPages(
  group: GroupDraft,
  pathPrefix: number[],
  pages: BaseSuitePage[],
  cells: BaseSuiteCell[],
): void {
  for (const [entryIndex, groupEntry] of group.entries.entries()) {
    if (groupEntry.kind === "page") {
      const path = [...pathPrefix, entryIndex];
      for (const cell of groupEntry.page.cells) cell.pagePath = path;
      pages.push({
        id: groupEntry.page.id,
        label: groupEntry.page.label,
        sectionId: groupEntry.page.sectionId,
        groupId: groupEntry.page.groupId,
        path,
        cellIds: groupEntry.page.cells.map((cell) => cell.id),
        entityCount: groupEntry.page.blueprint.entities?.length ?? 0,
        tileCount: groupEntry.page.blueprint.tiles?.length ?? 0,
      });
      cells.push(...groupEntry.page.cells);
      continue;
    }

    for (const [pageIndex, page] of groupEntry.pages.entries()) {
      const path = [...pathPrefix, entryIndex, pageIndex];
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
    }
  }
}

function entityCases(
  renderDb: RenderDb,
  names: readonly string[],
): { cases: CaseSpec[]; missing: string[] } {
  const cases: CaseSpec[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const def = renderDb.entities[name];
    if (!def) {
      missing.push(name);
      continue;
    }
    for (const pose of posesForEntity(name, def, {
      orientation64: BASE_ORIENTATION_64_ENTITIES,
      direction16: BASE_DIRECTION_16_ENTITIES,
      direction8: BASE_DIRECTION_8_ENTITIES,
    }))
      cases.push(poseCase(name, pose));
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
  const expectedEntities = new Set(BASE_ENTITY_NAMES);
  const expectedTiles = new Set(BASE_TILE_NAMES);
  const duplicateEntities = BASE_ENTITY_NAMES.filter(
    (name, index) => BASE_ENTITY_NAMES.indexOf(name) !== index,
  );
  const duplicateTiles = BASE_TILE_NAMES.filter(
    (name, index) => BASE_TILE_NAMES.indexOf(name) !== index,
  );
  const unexpectedEntities = Object.keys(renderDb.entities).filter(
    (name) => !expectedEntities.has(name),
  );
  const unexpectedTiles = Object.keys(renderDb.tiles).filter((name) => !expectedTiles.has(name));
  if (
    missingEntities.length > 0 ||
    missingTiles.length > 0 ||
    duplicateEntities.length > 0 ||
    duplicateTiles.length > 0 ||
    unexpectedEntities.length > 0 ||
    unexpectedTiles.length > 0
  ) {
    throw new Error(
      [
        missingEntities.length > 0 ? `entities: ${missingEntities.join(", ")}` : "",
        missingTiles.length > 0 ? `tiles: ${missingTiles.join(", ")}` : "",
        duplicateEntities.length > 0
          ? `duplicate entities: ${[...new Set(duplicateEntities)].join(", ")}`
          : "",
        duplicateTiles.length > 0
          ? `duplicate tiles: ${[...new Set(duplicateTiles)].join(", ")}`
          : "",
        unexpectedEntities.length > 0
          ? `unexpected entities: ${unexpectedEntities.join(", ")}`
          : "",
        unexpectedTiles.length > 0 ? `unexpected tiles: ${unexpectedTiles.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

export function buildBaseSuite(renderDb: RenderDb): BaseSuiteBuild {
  assertRenderMetadataCoverage(renderDb);

  const groupBuilders: Record<string, (db: RenderDb) => GroupDraft> = {
    logistics: logisticsGroup,
    production: productionGroup,
    space: spaceGroup,
    "combat-items": combatItemsGroup,
    "internal-legacy": internalLegacyGroup,
  };
  const rootGroups = BASE_GAME_BOOK_SPEC.children.map((entry) => {
    if (entry.kind !== "book") throw new Error(`Base root entry ${entry.id} must be a book`);
    const build = groupBuilders[entry.id];
    if (!build) throw new Error(`Missing Base group builder for ${entry.id}`);
    return build(renderDb);
  });

  const pages: BaseSuitePage[] = [];
  const cells: BaseSuiteCell[] = [];
  const rootBlueprintEntries: BlueprintBook["blueprints"] = [];

  rootGroups.forEach((group, rootIndex) => {
    appendGroupPages(group, [rootIndex], pages, cells);
    rootBlueprintEntries.push({
      index: rootIndex,
      blueprint_book: makeBook(group.label, group.icons, groupBookEntries(group.entries)),
    });
  });

  const document: BlueprintDocument = {
    blueprint_book: makeBook(
      BASE_GAME_BOOK_SPEC.label,
      specIcons(BASE_GAME_BOOK_SPEC),
      rootBlueprintEntries,
    ),
  };

  const manifest: BaseSuiteManifest = {
    schema: 1,
    suiteId: "base-game-2.1.11",
    gameVersion: BASE_GAME_VERSION,
    requiredMods: ["base"],
    canaryPageIds: [
      "entity-poses/logistics/inserters",
      "entity-poses/logistics/transport/car",
      "entity-poses/logistics/terrain",
    ],
    inventory: {
      source: "base-game-book-spec",
      specId: BASE_GAME_BOOK_SPEC.id,
      entityCount: BASE_ENTITY_NAMES.length,
      tileCount: BASE_TILE_NAMES.length,
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
