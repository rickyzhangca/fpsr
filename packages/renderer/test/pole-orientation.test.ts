import { describe, expect, it } from "vite-plus/test";
import {
  effectivePowerPoleDirection,
  getAngle,
  powerPoleRotationFromNeighbors,
  wireNeighborNumbers,
} from "../src/pole-orientation.js";
import type { Blueprint, BlueprintEntity } from "../src/types/blueprint.js";

describe("getAngle", () => {
  it("returns 0 for +X and 90 for +Y", () => {
    expect(getAngle(0, 0, 1, 0)).toBe(0);
    expect(getAngle(0, 0, 0, 1)).toBe(90);
    expect(getAngle(0, 0, -1, 0)).toBe(180);
  });
});

describe("powerPoleRotationFromNeighbors", () => {
  const centre = { x: 0.5, y: 0.5 };

  it("returns 0 with no neighbors", () => {
    expect(powerPoleRotationFromNeighbors(centre, [])).toBe(0);
  });

  // FBE folds 8 angle sectors into 4 orientations; pure axis neighbors
  // share orientations (N/S → 0, E/W → 8). Diagonals distinguish 4/12.
  it("maps pure cardinals like FBE (N/S→0, E/W→8)", () => {
    expect(powerPoleRotationFromNeighbors(centre, [{ x: 0.5, y: -1.5 }])).toBe(0);
    expect(powerPoleRotationFromNeighbors(centre, [{ x: 0.5, y: 2.5 }])).toBe(0);
    expect(powerPoleRotationFromNeighbors(centre, [{ x: 2.5, y: 0.5 }])).toBe(8);
    expect(powerPoleRotationFromNeighbors(centre, [{ x: -1.5, y: 0.5 }])).toBe(8);
  });

  it("maps NE to 4 and SE to 12", () => {
    expect(powerPoleRotationFromNeighbors(centre, [{ x: 2.5, y: -1.5 }])).toBe(4);
    expect(powerPoleRotationFromNeighbors(centre, [{ x: 2.5, y: 2.5 }])).toBe(12);
  });
});

describe("effectivePowerPoleDirection", () => {
  function ent(n: number, x: number, y: number, direction?: number): BlueprintEntity {
    return {
      entity_number: n,
      name: "small-electric-pole",
      position: { x, y },
      ...(direction !== undefined ? { direction } : {}),
    };
  }

  it("prefers explicit blueprint direction", () => {
    const a = ent(1, 0.5, 0.5, 8);
    const b = ent(2, 3.5, 0.5);
    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [a, b],
      wires: [[1, 5, 2, 5]],
    };
    const by = new Map([
      [1, a],
      [2, b],
    ]);
    expect(effectivePowerPoleDirection(a, bp, by)).toBe(8);
  });

  it("infers from copper wire neighbor when direction omitted", () => {
    const a = ent(1, 0.5, 0.5);
    const b = ent(2, 2.5, -1.5); // NE of a → direction 4
    const bp: Blueprint = {
      item: "blueprint",
      version: 2 * 2 ** 48,
      entities: [a, b],
      wires: [[1, 5, 2, 5]],
    };
    const by = new Map([
      [1, a],
      [2, b],
    ]);
    expect(wireNeighborNumbers(bp, 1)).toEqual([2]);
    expect(effectivePowerPoleDirection(a, bp, by)).toBe(4);
  });
});
