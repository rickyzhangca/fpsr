import {
  planDrawList,
  type AssetSource,
  type AssetTier,
  type Blueprint,
  type DrawList,
  type RenderDb,
  type RenderOptions,
} from "fpsr";

export interface TiledPreviewTierPlan {
  db: RenderDb;
  drawList: DrawList;
}

/**
 * Draw-list frame ids are local to an asset tier. Keep planning and painting
 * on the same render-db while deduplicating concurrent requests for that tier.
 */
export const createTiledPreviewTierPlanCache = (
  assets: AssetSource,
  blueprint: Blueprint,
  options: Pick<RenderOptions, "altMode" | "background">,
): ((tier: AssetTier) => Promise<TiledPreviewTierPlan>) => {
  const plans = new Map<AssetTier, Promise<TiledPreviewTierPlan>>();
  return (tier) => {
    let pending = plans.get(tier);
    if (!pending) {
      pending = assets
        .loadRenderDb(tier)
        .then((db) => ({
          db,
          drawList: planDrawList(blueprint, db, {
            altMode: options.altMode,
            background: options.background ?? null,
          }),
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
