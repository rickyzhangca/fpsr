import type { RenderDb } from "@rickyzhangca/fpsr";
import { baseGameRootBookSpec } from "../base-game-book-spec.js";
import { CASES_PER_ROW, chunk } from "../suite-layout.js";
import { buildFlatSpecGroup, entitySubsetCases, namespaceCases, pageEntities } from "./builders.js";
import type { CaseSpec, GroupDraft, PageBuildBehavior } from "./types.js";

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

export function internalLegacyGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(
    renderDb,
    baseGameRootBookSpec("internal-legacy"),
    "internal-legacy",
    INTERNAL_PAGE_BEHAVIORS,
  );
}
