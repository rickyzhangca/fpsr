import type { RenderDb } from "fpsr";
import { baseGameRootBookSpec } from "../base-game-book-spec.js";
import { buildFlatSpecGroup, entitySubsetCases, namespaceCases, pageEntities } from "./builders.js";
import type { CaseSpec, GroupDraft } from "./types.js";

const DEFENSE_PRINT_ENTITIES = pageEntities("combat-items/defense");
const TURRET_PRINT_ENTITIES = pageEntities("combat-items/turrets");

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

export function combatItemsGroup(renderDb: RenderDb): GroupDraft {
  return buildFlatSpecGroup(renderDb, baseGameRootBookSpec("combat-items"), "combat-items", {
    "combat-items/defense": { buildCaseRows: defensePrintCaseRows },
    "combat-items/turrets": { buildCaseRows: turretsCaseRows },
  });
}
