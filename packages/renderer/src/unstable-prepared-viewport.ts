/**
 * @experimental Unstable prepared-viewport painting hook.
 *
 * This entry is **not** covered by semver guarantees. Prefer `createRenderer().render`
 * / `renderTiledPng` for stable tiled output. The surface here exists so hosts that
 * need interactive per-tile paint (e.g. the in-repo viewer) can share the same
 * prepared-viewport path without reaching into package internals.
 *
 * Import: `@rickyzhangca/fpsr/unstable-prepared-viewport`
 */

export {
  renderPreparedViewport,
  type PreparedViewportRenderOptions,
} from "./internal/prepared-viewport.js";
