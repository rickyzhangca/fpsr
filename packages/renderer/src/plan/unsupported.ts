import type { BlueprintEntity } from "../types/blueprint.js";
import { type DrawCmd, RENDER_LAYERS, type RectCmd } from "../types/draw-list.js";
import type { RenderDb, SpriteVariant } from "../types/render-db.js";
import { spriteDest } from "./bounds.js";

/** Render-db icon key for the fpsr-owned unsupported mod entity marker. */
export const UNSUPPORTED_ENTITY_ICON_KEY = "utility/unsupported-entity";

/** Default 1×1 footprint for entities absent from the render-db (mod content). */
const UNSUPPORTED_ENTITY_BOX: [[number, number], [number, number]] = [
  [-0.5, -0.5],
  [0.5, 0.5],
];

/** Orange fallback when the baked marker frame is unavailable (tests, stale db). */
const UNSUPPORTED_ENTITY_COLOR: [number, number, number, number] = [1, 0.55, 0, 1];

/** 64px marker art at proto scale 0.5 → 1 tile on map. */
const UNSUPPORTED_ENTITY_MARKER_SCALE = 0.5;

function unsupportedEntityRect(entity: BlueprintEntity): RectCmd {
  const [[x1, y1], [x2, y2]] = UNSUPPORTED_ENTITY_BOX;
  return {
    kind: "rect",
    layer: RENDER_LAYERS.object,
    sortY: entity.position.y + y2,
    sortX: entity.position.x,
    entity: entity.entity_number,
    sub: 0,
    x: entity.position.x + x1,
    y: entity.position.y + y1,
    w: x2 - x1,
    h: y2 - y1,
    color: UNSUPPORTED_ENTITY_COLOR,
  };
}

export function unsupportedEntityCommand(entity: BlueprintEntity, db: RenderDb): DrawCmd {
  const frameId = db.icons[UNSUPPORTED_ENTITY_ICON_KEY];
  if (frameId != null) {
    const frame = db.frames[frameId];
    if (frame) {
      const variant: SpriteVariant = {
        frame: frameId,
        scale: UNSUPPORTED_ENTITY_MARKER_SCALE,
        shift: [0, 0],
      };
      const [, [, y2]] = UNSUPPORTED_ENTITY_BOX;
      const dest = spriteDest(entity.position.x, entity.position.y, frame, variant);
      return {
        kind: "sprite",
        layer: RENDER_LAYERS.object,
        sortY: entity.position.y + y2,
        sortX: entity.position.x,
        entity: entity.entity_number,
        sub: 0,
        frame: frameId,
        x: dest.x,
        y: dest.y,
        w: dest.w,
        h: dest.h,
      };
    }
  }
  return unsupportedEntityRect(entity);
}
