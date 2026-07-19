import type { BlueprintDocument } from "@rickyzhangca/fpsr";
import { describe, expect, it } from "vite-plus/test";
import { resolveSidebarSelection } from "./sidebar-selection";
import type { SidebarSource } from "./sidebar-tree";
const blueprintSource = (id: string, label: string, blueprintLabel?: string): SidebarSource => {
  const doc: BlueprintDocument = {
    blueprint: {
      item: "blueprint",
      version: 0,
      label: blueprintLabel,
      entities: [],
    },
  };
  return { id, label, doc };
};
const bookSource = (id: string, label: string): SidebarSource => {
  const doc: BlueprintDocument = {
    blueprint_book: {
      item: "blueprint-book",
      version: 0,
      label: "Root Book",
      active_index: 0,
      blueprints: [
        {
          index: 0,
          blueprint: {
            item: "blueprint",
            version: 0,
            label: "Nested Blueprint",
            entities: [],
          },
        },
        {
          index: 1,
          blueprint_book: {
            item: "blueprint-book",
            version: 0,
            label: "Nested Book",
            active_index: 0,
            blueprints: [
              {
                index: 0,
                blueprint: {
                  item: "blueprint",
                  version: 0,
                  label: "Deep Blueprint",
                  entities: [],
                },
              },
            ],
          },
        },
      ],
    },
  };
  return { id, label, doc };
};
describe("resolveSidebarSelection", () => {
  it("resolves a single blueprint source", () => {
    const sources = [blueprintSource("smoke", "Smoke", "Smoke Lab")];
    expect(resolveSidebarSelection(sources, "smoke", null)).toEqual({
      label: "Smoke Lab",
      kind: "blueprint",
      icons: undefined,
    });
  });
  it("uses an empty label when blueprint has no label", () => {
    const sources = [blueprintSource("smoke", "Smoke")];
    expect(resolveSidebarSelection(sources, "smoke", null).label).toBe("");
  });
  it("resolves a book root selection", () => {
    const sources = [bookSource("tests", "base items")];
    expect(resolveSidebarSelection(sources, "tests", null)).toMatchObject({
      label: "Root Book",
      kind: "book",
    });
  });
  it("resolves a nested blueprint path", () => {
    const sources = [bookSource("tests", "base items")];
    expect(resolveSidebarSelection(sources, "tests", [0])).toMatchObject({
      label: "Nested Blueprint",
      kind: "blueprint",
    });
  });
  it("resolves a nested book path", () => {
    const sources = [bookSource("tests", "base items")];
    expect(resolveSidebarSelection(sources, "tests", [1])).toMatchObject({
      label: "Nested Book",
      kind: "book",
    });
  });
  it("falls back for unknown source", () => {
    expect(resolveSidebarSelection([], "missing", null)).toEqual({
      label: "Select blueprint",
      kind: "blueprint",
    });
  });
  it("falls back to catalog label for unknown path within a source", () => {
    const sources = [bookSource("tests", "base items")];
    expect(resolveSidebarSelection(sources, "tests", [99])).toEqual({
      label: "base items",
      kind: "blueprint",
    });
  });
});
