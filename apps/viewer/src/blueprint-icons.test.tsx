// @vitest-environment jsdom
import type { Icon } from "fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./factorio-item-icon", () => ({
  FactorioItemIcon: ({ iconKey, quality }: { iconKey: string | string[]; quality?: string }) => {
    const key = Array.isArray(iconKey) ? iconKey[0] : iconKey;
    return <span data-testid="entity-icon" data-icon-key={key} data-quality={quality ?? ""} />;
  },
}));

import { BlueprintIcons } from "./blueprint-icons";

describe("BlueprintIcons", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("composites signal icons onto the blueprint paper background", () => {
    const icons: Icon[] = [
      { signal: { name: "fast-transport-belt" }, index: 1 },
      { signal: { name: "transport-belt" }, index: 2 },
    ];
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintIcons icons={icons} />);
    });

    const rendered = [...host.querySelectorAll("[data-testid=entity-icon]")];
    expect(rendered.map((el) => el.getAttribute("data-icon-key"))).toEqual([
      "item/blueprint",
      "item/fast-transport-belt",
      "item/transport-belt",
    ]);
    expect(host.querySelector('[aria-label="Blueprint icons"]')).toBeTruthy();

    act(() => root.unmount());
  });

  it("renders quality on signal overlays and shows blank blueprint when empty", () => {
    const root = createRoot(host);
    act(() => {
      root.render(
        <BlueprintIcons
          icons={[
            {
              signal: { type: "virtual", name: "signal-2", quality: "rare" },
              index: 1,
            },
          ]}
        />,
      );
    });
    const rendered = [...host.querySelectorAll("[data-testid=entity-icon]")];
    expect(rendered.map((el) => el.getAttribute("data-icon-key"))).toEqual([
      "item/blueprint",
      "virtual-signal/signal-2",
    ]);
    expect(rendered[1]?.getAttribute("data-quality")).toBe("rare");

    act(() => {
      root.render(<BlueprintIcons icons={[]} />);
    });
    expect(host.querySelector('[aria-label="Blueprint icons"]')).toBeTruthy();
    expect(host.querySelectorAll("[data-testid=entity-icon]")).toHaveLength(1);
    expect(host.querySelector("[data-testid=entity-icon]")?.getAttribute("data-icon-key")).toBe(
      "item/blueprint",
    );

    act(() => root.unmount());
  });

  it("uses book cover sizing when background is blueprint-book", () => {
    const icons: Icon[] = [
      { signal: { name: "iron-plate" }, index: 1 },
      { signal: { name: "copper-plate" }, index: 2 },
    ];
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintIcons icons={icons} backgroundKey="item/blueprint-book" />);
    });

    const tile = host.querySelector('[aria-label="Blueprint icons"]') as HTMLElement;
    expect(tile).toBeTruthy();
    expect(tile.style.width).toBe("64px");
    const overlays = [...host.querySelectorAll("[data-testid=entity-icon]")].slice(1);
    expect(overlays).toHaveLength(2);
    for (const overlay of overlays) {
      const span = overlay.parentElement as HTMLElement;
      expect(span.style.width).toBe("18px");
      expect(span.style.height).toBe("18px");
      expect(span.style.top).toBe(`${32 - 9 - 5}px`);
    }

    act(() => root.unmount());
  });
});
