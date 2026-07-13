import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  BlueprintSelectError,
  buildBookTree,
  listBlueprints,
  resolveActivePath,
  selectBlueprint,
} from "../src/book.js";
import { decode } from "../src/decode.js";
import type { BlueprintDocument } from "../src/types/blueprint.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../../fixtures/decode");

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
    expect(() => selectBlueprint(doc, [1])).toThrow(BlueprintSelectError);
    try {
      selectBlueprint(doc, [1]);
    } catch (e) {
      expect((e as BlueprintSelectError).reason).toBe("planner");
    }
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
    expect(tree!.items.root.children).toEqual(["0", "1"]);
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
    expect(tree!.items.root.icons).toEqual([
      { index: 1, signal: { type: "item", name: "iron-plate" } },
    ]);
    expect(tree!.items["0"].icons).toEqual([
      { index: 1, signal: { type: "item", name: "copper-plate" } },
    ]);
    expect(tree!.items["1"].icons).toEqual([
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
});
