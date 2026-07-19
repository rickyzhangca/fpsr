import type { DrawCmd, DrawList } from "fpsr";
type SortGroup = {
  layer: number;
  sortY: number;
  sortX: number;
  entity: number;
  sub: number;
};
type DisplayDrawList = {
  schema: DrawList["schema"];
  bounds: DrawList["bounds"];
  commands: Record<string, unknown>[];
};
const sortGroup = (cmd: DrawCmd): SortGroup => {
  return {
    layer: cmd.layer,
    sortY: cmd.sortY,
    sortX: cmd.sortX,
    entity: cmd.entity,
    sub: cmd.sub,
  };
};
const omitUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key as keyof T] = value as T[keyof T];
  }
  return out;
};
export const formatDrawCmd = (cmd: DrawCmd): Record<string, unknown> => {
  const sort = sortGroup(cmd);
  switch (cmd.kind) {
    case "rect":
      return {
        kind: cmd.kind,
        sort,
        rect: { x: cmd.x, y: cmd.y, w: cmd.w, h: cmd.h },
        color: cmd.color,
      };
    case "sprite": {
      const flags = omitUndefined({
        shadow: cmd.shadow,
        flipX: cmd.flipX,
        flipY: cmd.flipY,
        rotation: cmd.rotation,
      });
      return omitUndefined({
        kind: cmd.kind,
        sort,
        frame: cmd.frame,
        rect: { x: cmd.x, y: cmd.y, w: cmd.w, h: cmd.h },
        tint: cmd.tint,
        clip: cmd.clip,
        flags: Object.keys(flags).length > 0 ? flags : undefined,
      });
    }
    case "wire":
      return {
        kind: cmd.kind,
        sort,
        wire: cmd.wire,
        line: { x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2 },
      };
    case "train-chain":
      return {
        kind: cmd.kind,
        sort,
        segments: cmd.segments,
        joints: cmd.joints,
      };
    case "icon":
      return omitUndefined({
        kind: cmd.kind,
        sort,
        frame: cmd.frame,
        point: { x: cmd.x, y: cmd.y },
        size: cmd.size,
        backing: cmd.backing,
        backingFrame: cmd.backingFrame,
        backingStyle: cmd.backingStyle,
        rotation: cmd.rotation,
      });
    case "snap-grid":
      return {
        kind: cmd.kind,
        sort,
        rect: { x: cmd.x, y: cmd.y, w: cmd.w, h: cmd.h },
      };
    case "text":
      return omitUndefined({
        kind: cmd.kind,
        sort,
        text: cmd.text,
        point: { x: cmd.x, y: cmd.y },
        size: cmd.size,
        color: cmd.color,
        align: cmd.align,
        baseline: cmd.baseline,
      });
  }
};
export const formatDrawList = (list: DrawList): DisplayDrawList => {
  return {
    schema: list.schema,
    bounds: list.bounds,
    commands: list.commands.map(formatDrawCmd),
  };
};
