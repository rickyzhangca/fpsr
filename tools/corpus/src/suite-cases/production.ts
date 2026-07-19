import type { RenderDb } from "@rickyzhangca/fpsr";
import { baseGameRootBookSpec } from "../base-game-book-spec.js";
import { buildFlatSpecGroup, entitySubsetCases, namespaceCases, pageEntities } from "./builders.js";
import type { CaseSpec, GroupDraft, PageBuildBehavior } from "./types.js";

const ELECTRICITY_ENTITIES = pageEntities("entity-poses/production/electricity");
const RESOURCE_EXTRACTION_ENTITIES = pageEntities("entity-poses/production/resource-extraction");
const FURNACE_ENTITIES = pageEntities("entity-poses/production/furnaces");
const PRODUCTION_PRINT_ENTITIES = pageEntities("entity-poses/production/production");
const MODULES_ENTITIES = pageEntities("entity-poses/production/modules");

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

const PRODUCTION_PAGE_BEHAVIORS: Record<string, PageBuildBehavior> = {
  "entity-poses/production/electricity": { buildCaseRows: electricityCaseRows },
  "entity-poses/production/resource-extraction": {
    buildCaseRows: resourceExtractionCaseRows,
  },
  "entity-poses/production/furnaces": { buildCaseRows: furnaceCaseRows },
  "entity-poses/production/production": { buildCaseRows: productionPrintCaseRows },
  "entity-poses/production/modules": { buildCaseRows: modulesCaseRows },
};

export function productionGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(
    renderDb,
    baseGameRootBookSpec("production"),
    "entity-poses",
    PRODUCTION_PAGE_BEHAVIORS,
  );
}
