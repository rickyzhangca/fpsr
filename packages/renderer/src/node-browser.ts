/**
 * Browser stub for `@rickyzhangca/fpsr/node`.
 *
 * Bundlers that resolve the `browser` export condition hit this module instead
 * of the Node filesystem implementation.
 */

import type { AssetSource } from "./assets.js";

export function localAssets(_dir: string): AssetSource {
  throw new Error("@rickyzhangca/fpsr/node is Node-only; use cdnAssets in browsers");
}
