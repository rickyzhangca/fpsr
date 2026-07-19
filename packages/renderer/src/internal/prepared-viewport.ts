/**
 * In-repo prepared-viewport painting hook.
 *
 * This module is **not** part of the published package exports. The viewer and
 * other monorepo hosts import it via a source alias; external consumers should
 * use `render` / `renderTiledPng` only.
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
