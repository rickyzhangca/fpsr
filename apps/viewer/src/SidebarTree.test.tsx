// @vitest-environment jsdom
import type { BlueprintDocument } from "fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./BlueprintIcons", () => ({
  BlueprintIcons: () => <span data-testid="blueprint-icon" />,
}));

vi.mock("./FactorioItemIcon", () => ({
  FactorioItemIcon: () => <span data-testid="item-icon" />,
}));

import { SidebarTree } from "./SidebarTree";

describe("SidebarTree render progress", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
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
          sources={[{ id: "large", label: "Large factory", doc }]}
          selectedSourceId="large"
          selectedPath={null}
          renderProgress={{
            sourceId: "large",
            path: null,
            value: 47,
            label: "Loading assets 2/5",
          }}
          onSelect={vi.fn<(sourceId: string, path: number[]) => void>()}
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
          sources={[{ id: "large", label: "Large factory", doc }]}
          selectedSourceId="large"
          selectedPath={null}
          renderProgress={{
            sourceId: "large",
            path: null,
            value: 100,
            label: "Complete",
            durationMs: 1_234,
          }}
          onSelect={vi.fn<(sourceId: string, path: number[]) => void>()}
        />,
      );
    });

    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.textContent).toContain("1.2 s");
    expect(host.querySelector('[data-slot="tree-item-status"]')?.className).toContain("h-3");

    act(() => root.unmount());
  });
});
