import { entityInfoSilhouettePadPx } from "../icon-silhouette.js";
import { TRAIN_CHAIN_JOINT_RADIUS } from "../train-chains.js";
import type { DrawCmd, DrawList, SpriteCmd } from "../types/draw-list.js";
import type { FrameMeta, SpriteVariant } from "../types/render-db.js";

export function spriteDest(
  posX: number,
  posY: number,
  frame: FrameMeta,
  variant: SpriteVariant,
  extraShift?: [number, number],
): { x: number; y: number; w: number; h: number } {
  const w = (frame.sw * variant.scale) / 32;
  const h = (frame.sh * variant.scale * (variant.scaleY ?? 1)) / 32;
  const sx = extraShift?.[0] ?? 0;
  const sy = extraShift?.[1] ?? 0;
  const cx = posX + variant.shift[0] + sx;
  const cy = posY + variant.shift[1] + sy;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Open-side half of a UG/loader belt underlay (Factorio/FBE: only half the belt
 * shows under the hood). `openDir` is the direction toward the hood opening.
 */
export function undergroundBeltUnderlayClip(
  dest: { x: number; y: number; w: number; h: number },
  openDir: 0 | 4 | 8 | 12,
): { x: number; y: number; w: number; h: number } {
  switch (openDir) {
    case 4: // east half
      return { x: dest.x + dest.w / 2, y: dest.y, w: dest.w / 2, h: dest.h };
    case 12: // west half
      return { x: dest.x, y: dest.y, w: dest.w / 2, h: dest.h };
    case 8: // south half
      return { x: dest.x, y: dest.y + dest.h / 2, w: dest.w, h: dest.h / 2 };
    case 0: // north half
      return { x: dest.x, y: dest.y, w: dest.w, h: dest.h / 2 };
  }
}

export function expandBounds(
  bounds: DrawList["bounds"] | null,
  x: number,
  y: number,
  w: number,
  h: number,
): DrawList["bounds"] {
  const minX = x;
  const minY = y;
  const maxX = x + w;
  const maxY = y + h;
  if (!bounds) {
    return { minX, minY, maxX, maxY };
  }
  return {
    minX: Math.min(bounds.minX, minX),
    minY: Math.min(bounds.minY, minY),
    maxX: Math.max(bounds.maxX, maxX),
    maxY: Math.max(bounds.maxY, maxY),
  };
}

export function spriteVisibleBounds(
  cmd: SpriteCmd,
  frame: FrameMeta,
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (cmd.src) {
    return { x: cmd.x, y: cmd.y, w: cmd.w, h: cmd.h };
  }
  const scaleX = frame.sw === 0 ? 0 : cmd.w / frame.sw;
  const scaleY = frame.sh === 0 ? 0 : cmd.h / frame.sh;
  const cx = cmd.x + cmd.w / 2;
  const cy = cmd.y + cmd.h / 2;
  let left = cmd.x + frame.ox * scaleX;
  let top = cmd.y + frame.oy * scaleY;
  let right = left + frame.w * scaleX;
  let bottom = top + frame.h * scaleY;

  if (cmd.flipX) [left, right] = [2 * cx - right, 2 * cx - left];
  if (cmd.flipY) [top, bottom] = [2 * cy - bottom, 2 * cy - top];

  const rotation = cmd.rotation ?? 0;
  if (rotation % 360 !== 0) {
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const corners = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ] as const;
    const rotated = corners.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as const;
    });
    left = Math.min(...rotated.map(([x]) => x));
    top = Math.min(...rotated.map(([, y]) => y));
    right = Math.max(...rotated.map(([x]) => x));
    bottom = Math.max(...rotated.map(([, y]) => y));
  }

  if (cmd.clip) {
    left = Math.max(left, cmd.clip.x);
    top = Math.max(top, cmd.clip.y);
    right = Math.max(left, Math.min(right, cmd.clip.x + cmd.clip.w));
    bottom = Math.max(top, Math.min(bottom, cmd.clip.y + cmd.clip.h));
  }

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function includeCmdBounds(
  bounds: DrawList["bounds"] | null,
  cmd: DrawCmd,
  frames?: FrameMeta[],
  frameOverride?: FrameMeta,
): DrawList["bounds"] {
  switch (cmd.kind) {
    case "sprite": {
      const frame = frameOverride ?? frames?.[cmd.frame];
      const visible = frame ? spriteVisibleBounds(cmd, frame) : cmd;
      return expandBounds(bounds, visible.x, visible.y, visible.w, visible.h);
    }
    case "rect": {
      return expandBounds(bounds, cmd.x, cmd.y, cmd.w, cmd.h);
    }
    case "icon": {
      const backing = cmd.backingFrame == null ? undefined : frames?.[cmd.backingFrame];
      const isRequestPin = cmd.backingStyle === "request-pin";
      // Entity-info: 53 px no-scale backing around a 32 px scale-1 icon, plus
      // silhouette pad. Request-pin: cmd.size is opaque chrome width.
      const backingBasePx = isRequestPin ? Math.max(1, (backing?.w ?? 48) * (44 / 48)) : 32;
      const backingScale = cmd.size / backingBasePx;
      const silhouettePad =
        !isRequestPin &&
        (cmd.backingFrame != null || cmd.backing === true || cmd.silhouette === true)
          ? (entityInfoSilhouettePadPx() / 32) * cmd.size
          : 0;
      const width = Math.max(cmd.size + 2 * silhouettePad, (backing?.sw ?? 0) * backingScale);
      const height = Math.max(cmd.size + 2 * silhouettePad, (backing?.sh ?? 0) * backingScale);
      return expandBounds(bounds, cmd.x - width / 2, cmd.y - height / 2, width, height);
    }
    case "wire": {
      const minX = Math.min(cmd.x1, cmd.x2);
      const minY = Math.min(cmd.y1, cmd.y2);
      const maxX = Math.max(cmd.x1, cmd.x2);
      const maxY = Math.max(cmd.y1, cmd.y2);
      const mx = (cmd.x1 + cmd.x2) / 2;
      const my = (cmd.y1 + cmd.y2) / 2;
      const dist = Math.hypot(cmd.x2 - cmd.x1, cmd.y2 - cmd.y1);
      const sagY = my + 0.15 * dist;
      return expandBounds(
        expandBounds(bounds, minX, minY, maxX - minX, maxY - minY),
        mx,
        sagY,
        0,
        0,
      );
    }
    case "train-chain": {
      let b = bounds;
      for (const s of cmd.segments) {
        const minX = Math.min(s.x1, s.x2);
        const minY = Math.min(s.y1, s.y2);
        const maxX = Math.max(s.x1, s.x2);
        const maxY = Math.max(s.y1, s.y2);
        b = expandBounds(b, minX, minY, maxX - minX, maxY - minY);
      }
      for (const j of cmd.joints) {
        b = expandBounds(
          b,
          j.x - TRAIN_CHAIN_JOINT_RADIUS,
          j.y - TRAIN_CHAIN_JOINT_RADIUS,
          TRAIN_CHAIN_JOINT_RADIUS * 2,
          TRAIN_CHAIN_JOINT_RADIUS * 2,
        );
      }
      return b ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
  }
}
