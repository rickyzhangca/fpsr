import { BLUEPRINT_ADAPTERS, type Blueprint, type BlueprintEntity, decodeVersion } from "@rickyzhangca/fpsr";
import { describe, expect, it } from "vite-plus/test";
import { getAdapterChecks } from "./adapter-checks";

const bp1x = (entities: Blueprint["entities"]): Blueprint => {
  return {
    item: "blueprint",
    version: 1 * 2 ** 48,
    entities,
  };
};
const bp2x = (entities: Blueprint["entities"]): Blueprint => {
  return {
    item: "blueprint",
    version: 2 * 2 ** 48,
    entities,
  };
};

describe("getAdapterChecks", () => {
  it("returns all adapters unchecked for null blueprint", () => {
    const checks = getAdapterChecks(null);
    expect(checks.map((c) => c.id)).toEqual(BLUEPRINT_ADAPTERS.map((a) => a.id));
    expect(checks.every((c) => !c.used && c.affectedEntities === 0)).toBe(true);
    expect(checks.find((c) => c.id === "rename-legacy-entities")?.label).toBe(
      "Legacy entity names",
    );
  });

  it("returns all adapters unchecked for Factorio 2.x blueprints", () => {
    const checks = getAdapterChecks(
      bp2x([
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 2,
        },
      ]),
    );
    expect(checks.every((c) => !c.used)).toBe(true);
  });

  it("marks scale-legacy-directions when 1.x directions are present", () => {
    const checks = getAdapterChecks(
      bp1x([
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 2,
        },
      ]),
    );
    expect(checks.find((c) => c.id === "scale-legacy-directions")).toMatchObject({
      used: true,
      affectedEntities: 1,
    });
    expect(checks.find((c) => c.id === "items-object-to-array")?.used).toBe(false);
  });

  it("marks items-object-to-array when legacy items object is present", () => {
    const checks = getAdapterChecks(
      bp1x([
        {
          entity_number: 1,
          name: "assembling-machine-1",
          position: { x: 0.5, y: 0.5 },
          items: { "speed-module-3": 2 } as unknown as BlueprintEntity["items"],
        },
      ]),
    );
    expect(checks.find((c) => c.id === "items-object-to-array")).toMatchObject({
      used: true,
      affectedEntities: 1,
    });
  });

  it("marks rename-legacy-entities when 1.x prototype names are present", () => {
    const checks = getAdapterChecks(
      bp1x([
        {
          entity_number: 1,
          name: "curved-rail",
          position: { x: 0, y: 0 },
        },
        {
          entity_number: 2,
          name: "filter-inserter",
          position: { x: 0.5, y: 0.5 },
        },
      ]),
    );
    expect(checks.find((c) => c.id === "rename-legacy-entities")).toMatchObject({
      used: true,
      affectedEntities: 2,
    });
  });

  it("reports version major 2 as skipped", () => {
    const bp = bp2x([]);
    expect(decodeVersion(bp.version ?? 0).major).toBe(2);
    expect(getAdapterChecks(bp).every((c) => !c.used)).toBe(true);
  });
});
