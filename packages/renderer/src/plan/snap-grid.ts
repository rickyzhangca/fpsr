import { snapGridRect } from "../snap-grid.js";
import type { Blueprint } from "../types/blueprint.js";
import {
  type DrawCmd,
  type DrawList,
  RENDER_LAYERS,
  type SnapGridCmd,
} from "../types/draw-list.js";
import { includeCmdBounds } from "./bounds.js";

/** Emit the green snap-to-grid rectangle when the blueprint has snap metadata. */
export function emitSnapGrid(
  bp: Blueprint,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const rect = snapGridRect(bp);
  if (!rect) return bounds;

  const cmd: SnapGridCmd = {
    kind: "snap-grid",
    layer: RENDER_LAYERS["selection-box"],
    sortY: 0,
    sortX: 0,
    entity: 0,
    sub: 0,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
  };
  commands.push(cmd);
  return includeCmdBounds(bounds, cmd);
}
