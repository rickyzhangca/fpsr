import { describe, expect, it } from "vite-plus/test";
import {
  blueprintIconSignalCenter,
  blueprintIconSignalScale,
  blueprintIconSignalYOffsetPx,
  filledBlueprintIcons,
  planBlueprintIcons,
} from "../src/blueprint-icons.js";
import type { Icon } from "../src/types/blueprint.js";

describe("blueprint icon layout", () => {
  it("uses 48px for one icon and 28px for multi on a 64px blueprint tile", () => {
    expect(blueprintIconSignalScale(1, "blueprint")).toBe(48 / 64);
    expect(blueprintIconSignalScale(2, "blueprint")).toBe(28 / 64);
    expect(blueprintIconSignalScale(3, "blueprint")).toBe(28 / 64);
    expect(blueprintIconSignalScale(4, "blueprint")).toBe(28 / 64);
  });

  it("uses 24px for one icon and 18px for multi on a 64px book tile", () => {
    expect(blueprintIconSignalScale(1, "book")).toBe(24 / 64);
    expect(blueprintIconSignalScale(2, "book")).toBe(18 / 64);
    expect(blueprintIconSignalScale(3, "book")).toBe(18 / 64);
    expect(blueprintIconSignalScale(4, "book")).toBe(18 / 64);
  });

  it("packs two blueprint icons in one vertically-centered row", () => {
    expect(blueprintIconSignalCenter(2, 0, "blueprint")).toEqual({ x: 0.25, y: 0.5 });
    expect(blueprintIconSignalCenter(2, 1, "blueprint")).toEqual({ x: 0.75, y: 0.5 });
  });

  it("packs two book icons in one vertically-centered row", () => {
    expect(blueprintIconSignalCenter(2, 0, "book")).toEqual({ x: 21.5 / 64, y: 0.5 });
    expect(blueprintIconSignalCenter(2, 1, "book")).toEqual({ x: 42.5 / 64, y: 0.5 });
    expect(blueprintIconSignalYOffsetPx(64, 1, "book")).toBe(-4);
    expect(blueprintIconSignalYOffsetPx(64, 2, "book")).toBe(-5);
    expect(blueprintIconSignalYOffsetPx(64, 3, "book")).toBe(-6);
    expect(blueprintIconSignalYOffsetPx(64, 1, "blueprint")).toBe(0);
  });

  it("packs three blueprint icons into the first row and bottom-left", () => {
    expect(blueprintIconSignalCenter(3, 0, "blueprint")).toEqual({ x: 0.25, y: 0.25 });
    expect(blueprintIconSignalCenter(3, 1, "blueprint")).toEqual({ x: 0.75, y: 0.25 });
    expect(blueprintIconSignalCenter(3, 2, "blueprint")).toEqual({ x: 0.25, y: 0.75 });
  });

  it("fills all four blueprint corners when four icons are present", () => {
    expect(blueprintIconSignalCenter(4, 0, "blueprint")).toEqual({ x: 0.25, y: 0.25 });
    expect(blueprintIconSignalCenter(4, 1, "blueprint")).toEqual({ x: 0.75, y: 0.25 });
    expect(blueprintIconSignalCenter(4, 2, "blueprint")).toEqual({ x: 0.25, y: 0.75 });
    expect(blueprintIconSignalCenter(4, 3, "blueprint")).toEqual({ x: 0.75, y: 0.75 });
  });
});

describe("planBlueprintIcons", () => {
  it("filters icons to slots 1–4 and sorts by index", () => {
    const icons: Icon[] = [
      { signal: { name: "copper-plate" }, index: 3 },
      { signal: { name: "iron-plate" }, index: 1 },
      { signal: { name: "steel-plate" }, index: 0 },
      { signal: { name: "plastic-bar" }, index: 5 },
      { signal: { name: "transport-belt" }, index: 2 },
    ];
    expect(filledBlueprintIcons(icons).map((icon) => icon.index)).toEqual([1, 2, 3]);
  });

  it("plans signal positions and icon keys for blueprint paper", () => {
    const icons: Icon[] = [
      { signal: { name: "fast-transport-belt" }, index: 1 },
      { signal: { name: "transport-belt" }, index: 2 },
    ];
    const plan = planBlueprintIcons(icons);

    expect(plan.variant).toBe("blueprint");
    expect(plan.backgroundKey).toBe("item/blueprint");
    expect(plan.tileSize).toBe(64);
    expect(plan.signals).toHaveLength(2);
    expect(plan.signals[0]?.iconKeys).toEqual([
      "item/fast-transport-belt",
      "entity/fast-transport-belt",
      "recipe/fast-transport-belt",
    ]);
    expect(plan.signals[0]?.size).toBe(28);
    expect(plan.signals[0]?.left).toBe(0.25 * 64 - 14);
    expect(plan.signals[0]?.top).toBe(0.5 * 64 - 14);
    expect(plan.signals[1]?.left).toBe(0.75 * 64 - 14);
  });

  it("infers book variant from background key and applies book sizing", () => {
    const icons: Icon[] = [
      { signal: { name: "iron-plate" }, index: 1 },
      { signal: { name: "copper-plate" }, index: 2 },
    ];
    const plan = planBlueprintIcons(icons, { backgroundKey: "item/blueprint-book" });

    expect(plan.variant).toBe("book");
    expect(plan.signals).toHaveLength(2);
    expect(plan.signals[0]?.size).toBe(18);
    expect(plan.signals[0]?.top).toBe(0.5 * 64 - 9 - 5);
    expect(plan.signals[1]?.left).toBe(42.5 - 9);
  });

  it("scales layout to custom tile sizes", () => {
    const icons: Icon[] = [{ signal: { name: "iron-plate" }, index: 1 }];
    const plan = planBlueprintIcons(icons, { tileSize: 36 });

    expect(plan.tileSize).toBe(36);
    expect(plan.signals[0]?.size).toBe((48 / 64) * 36);
    expect(plan.signals[0]?.left).toBe(18 - ((48 / 64) * 36) / 2);
    expect(plan.signals[0]?.top).toBe(18 - ((48 / 64) * 36) / 2);
  });
});
