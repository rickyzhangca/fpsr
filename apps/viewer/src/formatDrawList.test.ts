import type { DrawCmd, DrawList } from "fpsr";
import { describe, expect, it } from "vite-plus/test";
import { formatDrawCmd, formatDrawList } from "./formatDrawList";

const list: DrawList = {
  schema: 1,
  bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
  commands: [
    {
      kind: "sprite",
      layer: 39,
      sortY: 1.5,
      sortX: 0.5,
      entity: 1,
      sub: 0,
      frame: 42,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      shadow: true,
    },
    {
      kind: "wire",
      layer: 46,
      sortY: 0,
      sortX: 0,
      entity: 0,
      sub: 0,
      wire: "copper",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
    },
  ],
};

describe("formatDrawCmd", () => {
  it("groups sprite sort keys and geometry", () => {
    const cmd = list.commands[0] as Extract<DrawCmd, { kind: "sprite" }>;
    expect(formatDrawCmd(cmd)).toEqual({
      kind: "sprite",
      sort: { layer: 39, sortY: 1.5, sortX: 0.5, entity: 1, sub: 0 },
      frame: 42,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      flags: { shadow: true },
    });
  });

  it("groups wire endpoints under line", () => {
    const cmd = list.commands[1] as Extract<DrawCmd, { kind: "wire" }>;
    expect(formatDrawCmd(cmd)).toEqual({
      kind: "wire",
      sort: { layer: 46, sortY: 0, sortX: 0, entity: 0, sub: 0 },
      wire: "copper",
      line: { x1: 0, y1: 0, x2: 1, y2: 0 },
    });
  });
});

describe("formatDrawList", () => {
  it("preserves list metadata and formats every command", () => {
    const formatted = formatDrawList(list);
    expect(formatted.schema).toBe(1);
    expect(formatted.bounds).toEqual(list.bounds);
    expect(formatted.commands).toHaveLength(2);
    expect(formatted.commands[0]).toHaveProperty("sort");
    expect(formatted.commands[0]).toHaveProperty("rect");
  });
});
