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
import { SidebarTree, type SidebarSelectableKind } from "./sidebar-tree";
describe("SidebarTree render progress", () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    localStorage.clear();
  });
  afterEach(() => {
    host.remove();
  });
  it("shows progress only on the matching blueprint item", () => {
    const doc: BlueprintDocument = {
      blueprint: { item: "blueprint", version: 0, label: "Large factory", entities: [] },
    };
    const root = createRoot(host);
    act(() => {
      root.render(
        <SidebarTree
          sectionId="demos"
          sources={[{ id: "large", label: "Large factory", doc }]}
          selectedSourceId="large"
          selectedPath={null}
          renderProgress={{
            sourceId: "large",
            path: null,
            value: 47,
            label: "Loading assets 2/5",
          }}
          onSelect={
            vi.fn<(sourceId: string, path: number[], kind: SidebarSelectableKind) => void>()
          }
        />,
      );
    });
    const progress = host.querySelector('[role="progressbar"]');
    expect(progress).toBeTruthy();
    expect(progress?.getAttribute("aria-valuenow")).toBe("47");
    expect(progress?.getAttribute("aria-label")).toBe("Large factory: Loading assets 2/5");
    expect(host.textContent).not.toContain("Loading assets 2/5");
    expect(host.querySelector('[data-slot="tree-item-status"]')?.className).toContain("h-3");
    act(() => {
      root.render(
        <SidebarTree
          sectionId="demos"
          sources={[{ id: "large", label: "Large factory", doc }]}
          selectedSourceId="large"
          selectedPath={null}
          renderProgress={{
            sourceId: "large",
            path: null,
            value: 100,
            label: "Complete",
            durationMs: 1234,
          }}
          onSelect={
            vi.fn<(sourceId: string, path: number[], kind: SidebarSelectableKind) => void>()
          }
        />,
      );
    });
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.textContent).toContain("1.2 s");
    expect(host.querySelector('[data-slot="tree-item-status"]')?.className).toContain("h-3");
    act(() => root.unmount());
  });

  it("selects upgrade planners and leaves deconstruction muted", () => {
    const onSelect =
      vi.fn<(sourceId: string, path: number[], kind: SidebarSelectableKind) => void>();
    const upgradeDoc: BlueprintDocument = {
      upgrade_planner: { item: "upgrade-planner", version: 0, settings: {} },
    };
    const deconDoc: BlueprintDocument = {
      deconstruction_planner: { item: "deconstruction-planner", version: 0, settings: {} },
    };
    const root = createRoot(host);
    act(() => {
      root.render(
        <SidebarTree
          sectionId="custom"
          sources={[
            { id: "up", label: "Upgrade planner", doc: upgradeDoc },
            { id: "decon", label: "Deconstruction planner", doc: deconDoc },
          ]}
          selectedSourceId="up"
          selectedPath={null}
          selectedKind="upgrade_planner"
          onSelect={onSelect}
        />,
      );
    });
    const buttons = [...host.querySelectorAll('[data-slot="tree-item-button"]')];
    const upgradeBtn = buttons.find((el) => el.textContent?.includes("Upgrade planner"));
    const deconBtn = buttons.find((el) => el.textContent?.includes("Deconstruction planner"));
    expect(upgradeBtn?.hasAttribute("data-muted")).toBe(false);
    expect(deconBtn?.hasAttribute("data-muted")).toBe(true);
    act(() => {
      upgradeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("up", [], "upgrade_planner");
    act(() => root.unmount());
  });
});
