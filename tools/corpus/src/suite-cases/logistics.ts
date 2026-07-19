import type { RenderDb } from "@rickyzhangca/fpsr";
import { baseGameRootBookSpec, type BaseGamePageSpec } from "../base-game-book-spec.js";
import { CARDINAL_DIRECTIONS, DIRECTIONS_16 } from "../entity-poses.js";
import { CASES_PER_ROW, chunk, itemIcons } from "../suite-layout.js";
import {
  buildSinglePage,
  entityCases,
  entitySubsetCases,
  pageEntities,
  pageTiles,
  poseCase,
  segmentCases,
  specIcons,
  tileCase,
} from "./builders.js";
import type {
  CaseSpec,
  GroupDraft,
  GroupBookEntry,
  PageBuildBehavior,
  PageDraft,
} from "./types.js";

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

export function logisticsGroup(renderDb: RenderDb): GroupDraft {
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
