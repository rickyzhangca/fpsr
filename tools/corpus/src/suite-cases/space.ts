import type { RenderDb } from "fpsr";
import { baseGameRootBookSpec } from "../base-game-book-spec.js";
import { buildFlatSpecGroup, entitySubsetCases, namespaceCases, pageEntities } from "./builders.js";
import type { CaseSpec, GroupDraft } from "./types.js";

const PLANETSIDE_ENTITIES = pageEntities("space/planetside");

function planetsideCaseRows(renderDb: RenderDb): CaseSpec[][] {
  return PLANETSIDE_ENTITIES.map((name) =>
    namespaceCases(entitySubsetCases(renderDb, [name]), "space", "planetside"),
  );
}

export function spaceGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(renderDb, baseGameRootBookSpec("space"), "space", {
    "space/planetside": { buildCaseRows: planetsideCaseRows },
  });
}
