import { describe, expect, it } from "vite-plus/test";
import { BLUEPRINT_ADAPTERS, migrateDocumentTo2x, migrateTo2x } from "../src/migrate.js";
import { decodeVersion, type Blueprint } from "../src/types/blueprint.js";

function bp1x(entities: Blueprint["entities"], extras?: Partial<Blueprint>): Blueprint {
  return {
    item: "blueprint",
    version: 1 * 2 ** 48,
    entities,
    ...extras,
  };
}

function bp2x(entities: Blueprint["entities"]): Blueprint {
  return {
    item: "blueprint",
    version: 2 * 2 ** 48,
    entities,
  };
}

describe("BLUEPRINT_ADAPTERS", () => {
  it("registers scale-legacy-directions and items-object-to-array", () => {
    expect(BLUEPRINT_ADAPTERS.map((a) => a.id)).toEqual([
      "scale-legacy-directions",
      "items-object-to-array",
    ]);
  });
});

describe("migrateTo2x", () => {
  it("scales Factorio 1.x directions and bumps version major to 2", () => {
    const input = bp1x([
      {
        entity_number: 1,
        name: "transport-belt",
        position: { x: 0.5, y: 0.5 },
        direction: 2,
      },
      {
        entity_number: 2,
        name: "transport-belt",
        position: { x: 1.5, y: 0.5 },
        direction: 6,
      },
      {
        entity_number: 3,
        name: "transport-belt",
        position: { x: 2.5, y: 0.5 },
      },
    ]);
    const out = migrateTo2x(input);
    expect(decodeVersion(out.version).major).toBe(2);
    expect(out.entities?.[0]?.direction).toBe(4);
    expect(out.entities?.[1]?.direction).toBe(12);
    expect(out.entities?.[2]?.direction).toBeUndefined();
    // Input unchanged.
    expect(input.entities?.[0]?.direction).toBe(2);
  });

  it("converts 1.x items objects to 2.x insert-plan arrays", () => {
    const input = bp1x([
      {
        entity_number: 1,
        name: "beacon",
        position: { x: 0.5, y: 0.5 },
      },
    ]);
    (input.entities![0] as { items: unknown }).items = { "speed-module-3": 2 };
    const out = migrateTo2x(input);
    expect(out.entities?.[0]?.items).toEqual([
      { id: { name: "speed-module-3", type: "item" }, items: { grid_count: 2 } },
    ]);
  });

  it("is idempotent on already-migrated blueprints", () => {
    const once = migrateTo2x(
      bp1x([
        {
          entity_number: 1,
          name: "transport-belt",
          position: { x: 0.5, y: 0.5 },
          direction: 6,
        },
      ]),
    );
    const twice = migrateTo2x(once);
    expect(twice).toBe(once);
    expect(twice.entities?.[0]?.direction).toBe(12);
  });

  it("leaves Factorio 2.x blueprints unchanged", () => {
    const input = bp2x([
      {
        entity_number: 1,
        name: "transport-belt",
        position: { x: 0.5, y: 0.5 },
        direction: 4,
      },
    ]);
    expect(migrateTo2x(input)).toBe(input);
  });
});

describe("migrateDocumentTo2x", () => {
  it("migrates a bare blueprint document", () => {
    const doc = migrateDocumentTo2x({
      blueprint: bp1x([
        {
          entity_number: 1,
          name: "inserter",
          position: { x: 0.5, y: 0.5 },
          direction: 2,
        },
      ]),
    });
    expect(doc.blueprint?.entities?.[0]?.direction).toBe(4);
    expect(decodeVersion(doc.blueprint!.version).major).toBe(2);
  });

  it("walks nested blueprint books", () => {
    const doc = migrateDocumentTo2x({
      blueprint_book: {
        item: "blueprint-book",
        version: 1 * 2 ** 48,
        blueprints: [
          {
            index: 0,
            blueprint: bp1x([
              {
                entity_number: 1,
                name: "transport-belt",
                position: { x: 0.5, y: 0.5 },
                direction: 6,
              },
            ]),
          },
          {
            index: 1,
            blueprint_book: {
              item: "blueprint-book",
              version: 1 * 2 ** 48,
              blueprints: [
                {
                  index: 0,
                  blueprint: bp1x([
                    {
                      entity_number: 1,
                      name: "transport-belt",
                      position: { x: 1.5, y: 1.5 },
                      direction: 2,
                    },
                  ]),
                },
              ],
            },
          },
        ],
      },
    });
    const book = doc.blueprint_book!;
    expect(decodeVersion(book.version).major).toBe(2);
    expect(book.blueprints?.[0]?.blueprint?.entities?.[0]?.direction).toBe(12);
    expect(
      book.blueprints?.[1]?.blueprint_book?.blueprints?.[0]?.blueprint?.entities?.[0]?.direction,
    ).toBe(4);
  });
});
