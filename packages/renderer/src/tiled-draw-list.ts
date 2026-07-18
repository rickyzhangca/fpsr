import { includeCmdBounds } from "./plan/bounds.js";
import type { DrawCmd, DrawList, DrawListBounds, RectCmd } from "./types/draw-list.js";
import type { FrameMeta } from "./types/render-db.js";

function intersects(left: DrawListBounds, right: DrawListBounds, bleed: number): boolean {
  return (
    left.maxX + bleed >= right.minX &&
    left.minX - bleed <= right.maxX &&
    left.maxY + bleed >= right.minY &&
    left.minY - bleed <= right.maxY
  );
}

const separator = (frame: DrawListBounds): RectCmd => ({
  kind: "rect",
  layer: 0,
  sortY: 0,
  sortX: 0,
  entity: 0,
  sub: 0,
  x: frame.minX,
  y: frame.minY,
  w: 0,
  h: 0,
  color: [0, 0, 0, 0],
});

/**
 * Retain commands that can affect one viewport while preserving shadow-run
 * boundaries. The transparent separators prevent independently composited
 * shadow runs from becoming adjacent after culling.
 */
export function drawListForTile(
  list: DrawList,
  frames: FrameMeta[],
  frame: DrawListBounds,
  bleedTiles = 0.25,
): DrawList {
  const commands: DrawCmd[] = [];
  let sourceShadowRun = 0;
  let sourceWasShadow = false;
  let lastIncludedShadowRun: number | undefined;

  for (const command of list.commands) {
    const isShadow = command.kind === "sprite" && command.shadow === true;
    if (isShadow && !sourceWasShadow) sourceShadowRun++;
    sourceWasShadow = isShadow;
    const bounds = includeCmdBounds(null, command, frames);
    if (!intersects(bounds, frame, bleedTiles)) continue;

    if (
      isShadow &&
      lastIncludedShadowRun != null &&
      lastIncludedShadowRun !== sourceShadowRun &&
      commands.at(-1)?.kind === "sprite" &&
      (commands.at(-1) as Extract<DrawCmd, { kind: "sprite" }>).shadow === true
    ) {
      commands.push(separator(frame));
    }
    commands.push(command);
    lastIncludedShadowRun = isShadow ? sourceShadowRun : undefined;
  }

  return { ...list, commands };
}
