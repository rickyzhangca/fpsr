/**
 * In-repo prepared-viewport painting hook.
 *
 * Prefer importing via `@rickyzhangca/fpsr/unstable-prepared-viewport` (experimental).
 * External consumers that only need full-frame or tiled PNG output should use
 * `render` / `renderTiledPng` instead.
 */

import {
  getPreparedViewportHandler,
  type PreparedViewportRenderOptions,
  type Renderer,
  type RenderResult,
} from "../renderer.js";
import type { Blueprint, BlueprintDocument } from "../types/blueprint.js";

export type { PreparedViewportRenderOptions };

export function renderPreparedViewport(
  renderer: Renderer,
  docOrBlueprint: BlueprintDocument | Blueprint,
  opts: PreparedViewportRenderOptions,
): Promise<RenderResult> {
  const handler = getPreparedViewportHandler(renderer);
  if (!handler) {
    throw new Error(
      "renderPreparedViewport requires a renderer created by createRenderer in this process",
    );
  }
  return handler(docOrBlueprint, opts);
}
