import { cdnAssets } from "fpsr";
import { ASSETS_BASE, MAX_CONCURRENT_ASSET_DECODES } from "./asset-config";

export const viewerAssets = cdnAssets(ASSETS_BASE, {
  maxConcurrentDecodes: MAX_CONCURRENT_ASSET_DECODES,
});
