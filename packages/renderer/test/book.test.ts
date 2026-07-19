import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  BlueprintSelectError,
  buildBookTree,
  listBlueprints,
  resolveActivePath,
  selectBlueprint,
  selectBook,
  selectUpgradePlanner,
} from "../src/book.js";
import { decode } from "../src/decode.js";
import type { BlueprintDocument } from "../src/types/blueprint.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../../fixtures/decode");

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

describe("listBlueprints", () => {
  it("flattens nested book fixture 05", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    const refs = listBlueprints(doc);
    expect(refs).toEqual([
      { path: [0], label: "First", depth: 0 },
      { path: [1], label: "Second (active)", depth: 0 },
      { path: [2, 0], label: "Nested blueprint", depth: 1 },
    ]);
  });

  it("skips planner entries in fixture 06", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "06-book-with-planner.txt"), "utf8"));
    const refs = listBlueprints(doc);
    expect(refs).toEqual([{ path: [0], label: "Only blueprint", depth: 0 }]);
  });
});

describe("selectBlueprint", () => {
  it("follows active_index through nesting by default", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    const bp = selectBlueprint(doc);
    expect(bp.label).toBe("Second (active)");
  });

  it("selects by explicit path", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    const bp = selectBlueprint(doc, [2, 0]);
    expect(bp.label).toBe("Nested blueprint");
  });

  it("throws when selecting a planner entry", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "06-book-with-planner.txt"), "utf8"));
    const error = captureError(() => selectBlueprint(doc, [1]));
    expect(error).toBeInstanceOf(BlueprintSelectError);
    expect((error as BlueprintSelectError).reason).toBe("planner");
  });
});

describe("selectBook", () => {
  it("returns the root book with no path", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    const book = selectBook(doc);
    expect(book.label).toBe("Main book");
  });

  it("selects a nested book by path", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    const book = selectBook(doc, [2]);
    expect(book.label).toBe("Nested book");
  });

  it("throws when path lands on a blueprint", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    const error = captureError(() => selectBook(doc, [0]));
    expect(error).toBeInstanceOf(BlueprintSelectError);
    expect((error as BlueprintSelectError).reason).toBe("not-found");
  });

  it("throws when path lands on a planner", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "06-book-with-planner.txt"), "utf8"));
    const error = captureError(() => selectBook(doc, [1]));
    expect(error).toBeInstanceOf(BlueprintSelectError);
    expect((error as BlueprintSelectError).reason).toBe("planner");
  });

  it("throws for bare blueprint documents", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "01-minimal-chest.txt"), "utf8"));
    expect(() => selectBook(doc)).toThrow(BlueprintSelectError);
  });
});

describe("buildBookTree", () => {
  it("builds hierarchy for nested book fixture 05", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    const tree = buildBookTree(doc);
    expect(tree).not.toBeNull();
    expect(tree!.rootId).toBe("root");
    expect(tree!.items.root).toEqual({
      id: "root",
      path: [],
      label: "Main book",
      kind: "book",
      children: ["0", "1", "2"],
    });
    expect(tree!.items["0"]).toMatchObject({
      kind: "blueprint",
      label: "First",
      path: [0],
      children: [],
    });
    expect(tree!.items["1"]).toMatchObject({
      kind: "blueprint",
      label: "Second (active)",
      path: [1],
    });
    expect(tree!.items["2"]).toMatchObject({
      kind: "book",
      label: "Nested book",
      path: [2],
      children: ["2.0"],
    });
    expect(tree!.items["2.0"]).toMatchObject({
      kind: "blueprint",
      label: "Nested blueprint",
      path: [2, 0],
    });
  });

  it("includes planner entries for fixture 06", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "06-book-with-planner.txt"), "utf8"));
    const tree = buildBookTree(doc);
    expect(tree).not.toBeNull();
    expect(tree!.items.root!.children).toEqual(["0", "1"]);
    expect(tree!.items["0"]).toMatchObject({ kind: "blueprint", label: "Only blueprint" });
    expect(tree!.items["1"]?.kind).toMatch(/planner/);
  });

  it("returns null for bare blueprint", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "01-minimal-chest.txt"), "utf8"));
    expect(buildBookTree(doc)).toBeNull();
  });

  it("carries icons on book and blueprint tree items", () => {
    const doc: BlueprintDocument = {
      blueprint_book: {
        item: "blueprint-book",
        version: 0,
        label: "Book with icons",
        icons: [{ index: 1, signal: { type: "item", name: "iron-plate" } }],
        blueprints: [
          {
            index: 0,
            blueprint: {
              item: "blueprint",
              version: 0,
              label: "BP with icons",
              icons: [{ index: 1, signal: { type: "item", name: "copper-plate" } }],
            },
          },
          {
            index: 1,
            blueprint_book: {
              item: "blueprint-book",
              version: 0,
              label: "Nested book",
              icons: [{ index: 1, signal: { type: "item", name: "steel-plate" } }],
              blueprints: [],
            },
          },
        ],
      },
    };
    const tree = buildBookTree(doc);
    expect(tree).not.toBeNull();
    expect(tree!.items.root!.icons).toEqual([
      { index: 1, signal: { type: "item", name: "iron-plate" } },
    ]);
    expect(tree!.items["0"]!.icons).toEqual([
      { index: 1, signal: { type: "item", name: "copper-plate" } },
    ]);
    expect(tree!.items["1"]!.icons).toEqual([
      { index: 1, signal: { type: "item", name: "steel-plate" } },
    ]);
  });
});

describe("resolveActivePath", () => {
  it("resolves active blueprint path in nested book", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "05-nested-book.txt"), "utf8"));
    expect(resolveActivePath(doc)).toEqual([1]);
  });

  it("returns [] for bare blueprint", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "01-minimal-chest.txt"), "utf8"));
    expect(resolveActivePath(doc)).toEqual([]);
  });

  it("resolves an active upgrade planner path", () => {
    const doc: BlueprintDocument = {
      blueprint_book: {
        item: "blueprint-book",
        version: 0,
        active_index: 2,
        blueprints: [
          { index: 0, upgrade_planner: { item: "upgrade-planner", version: 0, settings: {} } },
          { index: 1, upgrade_planner: { item: "upgrade-planner", version: 0, settings: {} } },
          { index: 2, upgrade_planner: { item: "upgrade-planner", version: 0, settings: {} } },
        ],
      },
    };
    expect(resolveActivePath(doc)).toEqual([2]);
  });
});

describe("selectUpgradePlanner", () => {
  it("returns the bare upgrade planner document payload", () => {
    const doc: BlueprintDocument = {
      upgrade_planner: {
        item: "upgrade-planner",
        version: 1,
        settings: { mappers: [{ index: 0, from: { name: "a" }, to: { name: "b" } }] },
      },
    };
    expect(selectUpgradePlanner(doc)).toBe(doc.upgrade_planner);
    expect(selectUpgradePlanner(doc, [])).toBe(doc.upgrade_planner);
  });

  it("selects an upgrade planner book entry by path", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "06-book-with-planner.txt"), "utf8"));
    const planner = selectUpgradePlanner(doc, [1]);
    expect(planner.item).toBe("upgrade-planner");
  });

  it("reads label and icons on upgrade planner tree items", () => {
    const doc: BlueprintDocument = {
      blueprint_book: {
        item: "blueprint-book",
        version: 0,
        blueprints: [
          {
            index: 0,
            upgrade_planner: {
              item: "upgrade-planner",
              version: 0,
              label: "Belt upgrades",
              icons: [{ index: 1, signal: { type: "item", name: "transport-belt" } }],
              settings: {},
            },
          },
        ],
      },
    };
    const tree = buildBookTree(doc);
    expect(tree!.items["0"]).toMatchObject({
      kind: "upgrade_planner",
      label: "Belt upgrades",
      icons: [{ index: 1, signal: { type: "item", name: "transport-belt" } }],
    });
  });

  it("derives upgrade planner tree icons from the first mapper to targets", () => {
    const doc: BlueprintDocument = {
      blueprint_book: {
        item: "blueprint-book",
        version: 0,
        blueprints: [
          {
            index: 0,
            upgrade_planner: {
              item: "upgrade-planner",
              version: 0,
              settings: {
                mappers: [
                  {
                    index: 0,
                    from: { type: "entity", name: "transport-belt" },
                    to: { type: "entity", name: "fast-transport-belt" },
                  },
                  {
                    index: 1,
                    from: { type: "entity", name: "inserter" },
                    to: { type: "entity", name: "fast-inserter" },
                  },
                ],
              },
            },
          },
        ],
      },
    };
    const tree = buildBookTree(doc);
    expect(tree!.items["0"]!.icons).toEqual([
      { index: 1, signal: { name: "fast-transport-belt", type: "entity" } },
      { index: 2, signal: { name: "fast-inserter", type: "entity" } },
    ]);
  });

  it("throws for non-planner documents and invalid paths", () => {
    const bare = decode(readFileSync(join(FIXTURES_DIR, "01-minimal-chest.txt"), "utf8"));
    expect(() => selectUpgradePlanner(bare)).toThrow(BlueprintSelectError);

    const book = decode(readFileSync(join(FIXTURES_DIR, "06-book-with-planner.txt"), "utf8"));
    const missingPath = captureError(() => selectUpgradePlanner(book));
    expect(missingPath).toBeInstanceOf(BlueprintSelectError);
    expect((missingPath as BlueprintSelectError).reason).toBe("not-found");

    const blueprintPath = captureError(() => selectUpgradePlanner(book, [0]));
    expect(blueprintPath).toBeInstanceOf(BlueprintSelectError);
    expect((blueprintPath as BlueprintSelectError).reason).toBe("not-found");
  });
});
