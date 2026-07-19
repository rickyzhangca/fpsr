// @vitest-environment jsdom
import type { BlueprintDocument } from "fpsr";
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

import { UpgradePlannerSummary } from "./upgrade-planner-summary";

describe("UpgradePlannerSummary", () => {
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

  it("renders label and version without a DOM mapper grid", () => {
    const planner = {
      item: "upgrade-planner",
      label: "Belt upgrades",
      version: 562954249109505,
      settings: { mappers: [] },
    };
    const root = createRoot(host);
    act(() => {
      root.render(<UpgradePlannerSummary planner={planner} sourceBytes={128} />);
    });
    expect(host.textContent).toContain("Belt upgrades");
    expect(host.textContent).toContain("2.1.11");
    expect(host.textContent).toContain("0.13 KB");
    expect(host.querySelector('[aria-label="Upgrade planner mappings"]')).toBeNull();
    act(() => root.unmount());
  });
});

describe("upgrade planner sidebar selection", () => {
  it("exposes selectable upgrade planner kind via docToSidebarItems", async () => {
    const { docToSidebarItems } = await import("./sidebar-tree");
    const doc: BlueprintDocument = {
      upgrade_planner: {
        item: "upgrade-planner",
        version: 1,
        label: "My upgrades",
        settings: {
          mappers: [
            {
              index: 0,
              from: { type: "entity", name: "transport-belt" },
              to: { type: "entity", name: "fast-transport-belt" },
            },
          ],
        },
      },
    };
    const items = docToSidebarItems({ id: "up", label: "fallback", doc });
    expect(items.up).toMatchObject({
      kind: "upgrade_planner",
      label: "My upgrades",
      path: [],
      icons: [{ index: 1, signal: { name: "fast-transport-belt", type: "entity" } }],
    });
  });
});

describe("selectionForDoc", () => {
  it("selects upgrade_planner for planner-only documents", async () => {
    const { selectionForDoc, sourceLabel } = await import("@/shell/built-in-sources");
    const doc: BlueprintDocument = {
      upgrade_planner: { item: "upgrade-planner", version: 1, settings: {} },
    };
    expect(selectionForDoc(doc)).toEqual({ path: null, kind: "upgrade_planner" });
    expect(sourceLabel(doc, "Untitled")).toBe("Upgrade planner");
  });

  it("selects the active upgrade planner inside a planner-only book", async () => {
    const { selectionForDoc } = await import("@/shell/built-in-sources");
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
    expect(selectionForDoc(doc)).toEqual({ path: [2], kind: "upgrade_planner" });
  });
});
