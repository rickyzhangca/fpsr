import type { Blueprint } from "fpsr";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("fpsr", () => ({
  decodeVersion: (v: number) => ({
    major: Math.floor(v / 2 ** 48) % 2 ** 16,
    minor: Math.floor(v / 2 ** 32) % 2 ** 16,
    patch: Math.floor(v / 2 ** 16) % 2 ** 16,
  }),
  encode: () => "0" + "x".repeat(99),
}));

import {
  countBlueprintComponentsByName,
  countEntitiesByName,
  encodedBookByteSize,
  encodedByteSize,
  formatByteSize,
  formatContents,
  formatGameVersion,
  formatSnapping,
} from "./blueprintMeta";

describe("blueprintMeta", () => {
  it("formats game version", () => {
    const version = 2 * 2 ** 48 + 1 * 2 ** 32 + 11 * 2 ** 16;
    expect(formatGameVersion(version)).toBe("2.1.11");
  });

  it("formats snapping as none when unset", () => {
    expect(formatSnapping({ item: "blueprint", version: 0 })).toBe("None");
  });

  it("formats absolute snapping with grid and offset", () => {
    const bp: Blueprint = {
      item: "blueprint",
      version: 0,
      "absolute-snapping": true,
      "snap-to-grid": { x: 2, y: 2 },
      "position-relative-to-grid": { x: 0, y: 0 },
    };
    expect(formatSnapping(bp)).toBe("absolute · grid 2×2 · offset 0,0");
  });

  it("counts entities by name sorted by count then name", () => {
    expect(
      countEntitiesByName([
        { entity_number: 1, name: "transport-belt", position: { x: 0, y: 0 } },
        { entity_number: 2, name: "assembling-machine-2", position: { x: 1, y: 0 } },
        { entity_number: 3, name: "transport-belt", position: { x: 2, y: 0 } },
        { entity_number: 4, name: "inserter", position: { x: 3, y: 0 } },
      ]),
    ).toEqual([
      { name: "transport-belt", count: 2 },
      { name: "assembling-machine-2", count: 1 },
      { name: "inserter", count: 1 },
    ]);
  });

  it("counts tiles alongside entities for blueprint components", () => {
    expect(
      countBlueprintComponentsByName(
        [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
        [
          { name: "refined-concrete", position: { x: 0, y: 0 } },
          { name: "refined-concrete", position: { x: 1, y: 0 } },
        ],
      ),
    ).toEqual([
      { name: "refined-concrete", count: 2 },
      { name: "wooden-chest", count: 1 },
    ]);
  });

  it("merges hazard-concrete left/right tiles by placing item", () => {
    const tileItemByName = {
      "hazard-concrete-left": "hazard-concrete",
      "hazard-concrete-right": "hazard-concrete",
    };
    expect(
      countBlueprintComponentsByName(
        undefined,
        [
          { name: "hazard-concrete-left", position: { x: 0, y: 0 } },
          { name: "hazard-concrete-right", position: { x: 1, y: 0 } },
          { name: "hazard-concrete-left", position: { x: 2, y: 0 } },
        ],
        tileItemByName,
      ),
    ).toEqual([{ name: "hazard-concrete", count: 3 }]);
  });

  it("remaps stone-path to stone-brick via placing item", () => {
    expect(
      countBlueprintComponentsByName(
        undefined,
        [
          { name: "stone-path", position: { x: 0, y: 0 } },
          { name: "stone-path", position: { x: 1, y: 0 } },
        ],
        { "stone-path": "stone-brick" },
      ),
    ).toEqual([{ name: "stone-brick", count: 2 }]);
  });

  it("keeps tile prototype name when no placing-item map entry", () => {
    expect(
      countBlueprintComponentsByName(
        undefined,
        [{ name: "refined-concrete", position: { x: 0, y: 0 } }],
        {},
      ),
    ).toEqual([{ name: "refined-concrete", count: 1 }]);
  });

  it("formats contents and byte size", () => {
    expect(formatContents(undefined)).toBe("none");
    expect(
      formatContents([
        { entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: "wooden-chest", position: { x: 1.5, y: 0.5 } },
      ]),
    ).toBe("wooden-chest ×2");
    expect(encodedByteSize({ item: "blueprint", version: 0 })).toBe(100);
    expect(encodedBookByteSize({ item: "blueprint-book", version: 0, blueprints: [] })).toBe(100);
    expect(formatByteSize(1234)).toBe("1.21 KB");
  });
});
