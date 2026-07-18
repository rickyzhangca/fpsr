// @vitest-environment jsdom
import type { Blueprint } from "fpsr";
import { createStore, Provider } from "jotai";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { encodedByteSize, formatByteSize } from "@/blueprint/blueprint-meta";
import { BlueprintSummary } from "./blueprint-summary";
import { VIEWER_PREFERENCE_KEYS } from "@/shell/viewer-preferences";
vi.mock("@/blueprint/factorio-item-icon", () => ({
  FactorioItemIcon: ({ iconKey, quality }: { iconKey: string | string[]; quality?: string }) => {
    const key = Array.isArray(iconKey) ? iconKey[0] : iconKey;
    return <span data-testid="entity-icon" data-icon-key={key} data-quality={quality ?? ""} />;
  },
}));
vi.mock("@/shell/viewer-assets", () => ({
  viewerAssets: {
    loadRenderDb: vi.fn().mockResolvedValue({ tiles: {} }),
  },
}));
describe("BlueprintSummary", () => {
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
  it("shows blueprint metadata fields", async () => {
    const version = 2 * 2 ** 48 + 1 * 2 ** 32 + 11 * 2 ** 16;
    const blueprint: Blueprint = {
      item: "blueprint",
      version,
      label: "Meta test",
      description: "A test blueprint",
      "absolute-snapping": true,
      "snap-to-grid": { x: 2, y: 2 },
      "position-relative-to-grid": { x: 0, y: 0 },
      entities: [
        { entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } },
        { entity_number: 2, name: "wooden-chest", position: { x: 1.5, y: 0.5 } },
        { entity_number: 3, name: "inserter", position: { x: 2.5, y: 0.5 } },
      ],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintSummary blueprint={blueprint} tileSize="1×1 tiles" />);
    });
    const text = host.textContent ?? "";
    expect(text).toContain("Meta test");
    expect(text).toContain("A test blueprint");
    expect(text).toContain("Byte size");
    expect(text).toContain(formatByteSize(encodedByteSize(blueprint)));
    expect(text).toContain("Version");
    expect(text).toContain("2.1.11");
    expect(text).toContain("Snapping");
    expect(text).toContain("absolute · grid 2×2 · offset 0,0");
    expect(text).toContain("Size");
    expect(text).toContain("1×1 tiles");
    expect(text).toContain("Components");
    await vi.waitFor(() => {
      expect(host.textContent).toContain("2");
      expect(host.textContent).toContain("1");
      const icons = [...host.querySelectorAll("[data-testid=entity-icon]")];
      expect(icons.map((el) => el.getAttribute("data-icon-key"))).toEqual([
        "item/blueprint",
        "item/wooden-chest",
        "item/inserter",
      ]);
      expect(host.querySelector('[aria-label="wooden-chest"]')).toBeTruthy();
      expect(host.querySelector('[aria-label="inserter"]')).toBeTruthy();
    });
    expect(host.querySelector('[aria-label="Blueprint icons"]')).toBeTruthy();
    act(() => root.unmount());
  });
  it("renders blueprint tile icons beside the title and description", () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Icon test",
      description: "Blueprint with icons",
      icons: [
        { signal: { name: "assembling-machine-2" }, index: 1 },
        { signal: { name: "transport-belt" }, index: 2 },
        {
          signal: { type: "virtual", name: "signal-2", quality: "rare" },
          index: 3,
        },
        {
          signal: {
            type: "recipe",
            name: "simple-coal-liquefaction",
            quality: "legendary",
          },
          index: 4,
        },
      ],
      entities: [],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintSummary blueprint={blueprint} tileSize="—" />);
    });
    expect(host.querySelector('[aria-label="Blueprint icons"]')).toBeTruthy();
    const icons = [...host.querySelectorAll("[data-testid=entity-icon]")];
    expect(icons.map((el) => el.getAttribute("data-icon-key"))).toEqual([
      "item/blueprint",
      "item/assembling-machine-2",
      "item/transport-belt",
      "virtual-signal/signal-2",
      "recipe/simple-coal-liquefaction",
    ]);
    expect(icons.map((el) => el.getAttribute("data-quality"))).toEqual([
      "",
      "",
      "",
      "rare",
      "legendary",
    ]);
    act(() => root.unmount());
  });
  it("shows fallback when description is missing", () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "No desc",
      entities: [],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintSummary blueprint={blueprint} tileSize="—" />);
    });
    expect(host.textContent).toContain("No description");
    expect(host.querySelector('[aria-label="Blueprint icons"]')).toBeTruthy();
    act(() => root.unmount());
  });
  it("collapses and expands the summary details", () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Toggle test",
      description: "Hidden when collapsed",
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintSummary blueprint={blueprint} tileSize="1×1 tiles" />);
    });
    expect(host.textContent).toContain("Hidden when collapsed");
    expect(host.textContent).toContain("Components");
    const toggle = host.querySelector('[aria-label="Collapse summary"]');
    expect(toggle).toBeTruthy();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Toggle test");
    expect(host.textContent).toContain("Hidden when collapsed");
    expect(host.textContent).not.toContain("Components");
    expect(host.querySelector('[aria-label="Expand summary"]')).toBeTruthy();
    act(() => {
      host
        .querySelector('[aria-label="Expand summary"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Hidden when collapsed");
    expect(host.textContent).toContain("Components");
    act(() => root.unmount());
  });

  it("restores the collapsed summary in a fresh store", () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Persistent summary",
      entities: [],
    };
    const firstRoot = createRoot(host);
    act(() => {
      firstRoot.render(
        <Provider store={createStore()}>
          <BlueprintSummary blueprint={blueprint} tileSize="0×0 tiles" />
        </Provider>,
      );
    });
    act(() => {
      host
        .querySelector('[aria-label="Collapse summary"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(localStorage.getItem(VIEWER_PREFERENCE_KEYS.summaryExpanded)).toBe("false");
    act(() => firstRoot.unmount());

    const secondRoot = createRoot(host);
    act(() => {
      secondRoot.render(
        <Provider store={createStore()}>
          <BlueprintSummary blueprint={blueprint} tileSize="0×0 tiles" />
        </Provider>,
      );
    });
    expect(host.querySelector('[aria-label="Expand summary"]')).toBeTruthy();
    act(() => secondRoot.unmount());
  });

  it("truncates long label and description when collapsed", () => {
    const longLabel = "A".repeat(200);
    const longDescription = "B".repeat(300);
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: longLabel,
      description: longDescription,
      entities: [],
    };
    localStorage.setItem(VIEWER_PREFERENCE_KEYS.summaryExpanded, "false");
    const root = createRoot(host);
    act(() => {
      root.render(
        <Provider store={createStore()}>
          <BlueprintSummary blueprint={blueprint} tileSize="0×0 tiles" />
        </Provider>,
      );
    });
    expect(host.querySelector('[aria-label="Expand summary"]')).toBeTruthy();
    const title = host.querySelector("h2");
    const description = host.querySelector("dd");
    expect(title?.className).toContain("truncate");
    expect(description?.className).toContain("truncate");
    expect(title?.parentElement?.className).toMatch(/min-w-0/);
    expect(title?.parentElement?.className).toMatch(/overflow-hidden/);
    act(() => root.unmount());
  });
});
