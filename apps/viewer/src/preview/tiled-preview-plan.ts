import {
  type AssetSource,
  type AssetTier,
  type BlueprintDocument,
  type DrawList,
  type RenderDb,
  type RenderOptions,
  selectBlueprint,
  selectDeconstructionPlanner,
  selectUpgradePlanner,
} from "@rickyzhangca/fpsr";
import {
  planDeconstructionPlannerDrawList,
  planDrawList,
  planUpgradePlannerDrawList,
} from "@rickyzhangca/fpsr/planner";

export interface TiledPreviewTierPlan {
  db: RenderDb;
  drawList: DrawList;
}

export interface TiledPreviewPlanOptions extends Pick<RenderOptions, "altMode" | "background"> {
  blueprintPath?: number[];
}

function planDocumentForPreview(
  doc: BlueprintDocument,
  db: RenderDb,
  options: TiledPreviewPlanOptions,
): DrawList {
  try {
    const planner = selectUpgradePlanner(doc, options.blueprintPath);
    return planUpgradePlannerDrawList(planner, db);
  } catch {
    try {
      const planner = selectDeconstructionPlanner(doc, options.blueprintPath);
      return planDeconstructionPlannerDrawList(planner, db);
    } catch {
      const blueprint = selectBlueprint(doc, options.blueprintPath);
      return planDrawList(blueprint, db, { altMode: options.altMode });
    }
  }
}

/**
 * Draw-list frame ids are local to an asset tier. Keep planning and painting
 * on the same render-db while deduplicating concurrent requests for that tier.
 */
export const createTiledPreviewTierPlanCache = (
  assets: AssetSource,
  doc: BlueprintDocument,
  options: TiledPreviewPlanOptions,
): ((tier: AssetTier) => Promise<TiledPreviewTierPlan>) => {
  const plans = new Map<AssetTier, Promise<TiledPreviewTierPlan>>();
  return (tier) => {
    let pending = plans.get(tier);
    if (!pending) {
      pending = assets
        .loadRenderDb(tier)
        .then((db) => ({
          db,
          drawList: planDocumentForPreview(doc, db, options),
        }))
        .catch((error) => {
          plans.delete(tier);
          throw error;
        });
      plans.set(tier, pending);
    }
    return pending;
  };
};
