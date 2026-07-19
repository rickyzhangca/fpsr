// @vitest-environment jsdom
import type { BlueprintDocument } from "@rickyzhangca/fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/blueprint/blueprint-icons", () => ({
  BlueprintIcons: () => <span data-testid="blueprint-icon" />,
}));
vi.mock("@/blueprint/factorio-item-icon", () => ({
  FactorioItemIcon: () => <span data-testid="item-icon" />,
}));
vi.mock("@/blueprint/factorio-rich-text", () => ({
  FactorioRichText: ({ text, fallback }: { text?: string; fallback?: string }) => (
    <span>{text || fallback}</span>
  ),
}));

import { DeconstructionPlannerSummary } from "./deconstruction-planner-summary";

describe("DeconstructionPlannerSummary", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("renders label and version", () => {
    const planner = {
      item: "deconstruction-planner",
      label: "Clear belts",
      version: 562954249109505,
      settings: {},
    };
    const root = createRoot(host);
    act(() => {
      root.render(<DeconstructionPlannerSummary planner={planner} sourceBytes={128} />);
    });
    expect(host.textContent).toContain("Clear belts");
    expect(host.textContent).toContain("2.1.11");
    expect(host.textContent).toContain("0.13 KB");
    act(() => root.unmount());
  });
});

describe("deconstruction planner sidebar selection", () => {
  it("exposes selectable deconstruction planner kind via docToSidebarItems", async () => {
    const { docToSidebarItems } = await import("./sidebar-tree");
    const doc: BlueprintDocument = {
      deconstruction_planner: {
        item: "deconstruction-planner",
        version: 1,
        label: "My filters",
        settings: {
          entity_filters: [{ index: 0, name: "storage-tank", type: "entity" }],
        },
      },
    };
    const items = docToSidebarItems({ id: "decon", label: "fallback", doc });
    expect(items.decon).toMatchObject({
      kind: "deconstruction_planner",
      label: "My filters",
      path: [],
      icons: [{ index: 1, signal: { name: "storage-tank", type: "entity" } }],
    });
  });
});

describe("selectionForDoc deconstruction", () => {
  it("selects deconstruction_planner for planner-only documents", async () => {
    const { selectionForDoc, sourceLabel } = await import("@/shell/built-in-sources");
    const doc: BlueprintDocument = {
      deconstruction_planner: { item: "deconstruction-planner", version: 1, settings: {} },
    };
    expect(selectionForDoc(doc)).toEqual({ path: null, kind: "deconstruction_planner" });
    expect(sourceLabel(doc, "Untitled")).toBe("Deconstruction planner");
  });

  it("selects the active deconstruction planner inside a planner-only book", async () => {
    const { selectionForDoc } = await import("@/shell/built-in-sources");
    const doc: BlueprintDocument = {
      blueprint_book: {
        item: "blueprint-book",
        version: 0,
        active_index: 0,
        blueprints: [
          {
            index: 0,
            deconstruction_planner: { item: "deconstruction-planner", version: 0, settings: {} },
          },
          {
            index: 1,
            deconstruction_planner: { item: "deconstruction-planner", version: 0, settings: {} },
          },
        ],
      },
    };
    expect(selectionForDoc(doc)).toEqual({ path: [0], kind: "deconstruction_planner" });
  });
});
