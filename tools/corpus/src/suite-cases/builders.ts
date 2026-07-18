import type { BlueprintEntity, Icon, RenderDb, Tile } from "fpsr";
import {
  BASE_DIRECTION_16_ENTITIES,
  BASE_DIRECTION_8_ENTITIES,
  BASE_ORIENTATION_64_ENTITIES,
  baseGamePageSpec,
  type BaseGameBookSpec,
  type BaseGamePageSpec,
} from "../base-game-book-spec.js";
import { poseCellId, posesForEntity, type EntityPose } from "../entity-poses.js";
import {
  BLUEPRINT_VERSION,
  CASES_PER_ROW,
  CROP_MARGIN_TILES,
  chunk,
  itemIcons,
  packCaseRows,
  placementBounds,
  placementLattice,
} from "../suite-layout.js";
import type {
  BaseSuiteCell,
  CaseSpec,
  GroupDraft,
  GroupBookEntry,
  MaterializedCase,
  PageBuildBehavior,
  PageDraft,
} from "./types.js";

export function materializeCase(spec: CaseSpec, renderDb: RenderDb): MaterializedCase {
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

export function poseCase(name: string, pose: EntityPose): CaseSpec {
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

export function tileCase(name: string): CaseSpec {
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

export function buildSinglePage(
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

  for (const packedRow of packCaseRows(rows)) {
    for (const { item: testCase, translateX, translateY, placedBounds } of packedRow) {
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

export function pageEntities(id: string): readonly string[] {
  return baseGamePageSpec(id).entities ?? [];
}

export function pageTiles(id: string): readonly string[] {
  return baseGamePageSpec(id).tiles ?? [];
}

export function specIcons(spec: Pick<BaseGameBookSpec | BaseGamePageSpec, "icons">): Icon[] {
  return itemIcons(...spec.icons);
}

export function entityCases(
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

export function entitySubsetCases(renderDb: RenderDb, names: readonly string[]): CaseSpec[] {
  return entityCases(renderDb, names).cases;
}

export function namespaceCases(cases: CaseSpec[], groupId: string, segmentId: string): CaseSpec[] {
  return cases.map((testCase) => ({
    ...testCase,
    id: `${groupId}/${segmentId}/${testCase.id}`,
  }));
}

export function segmentCases(cases: CaseSpec[], segmentId: string): CaseSpec[] {
  return namespaceCases(cases, "logistics", segmentId);
}

export function buildFlatSpecGroup(
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
