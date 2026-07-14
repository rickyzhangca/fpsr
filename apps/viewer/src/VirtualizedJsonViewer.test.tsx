// @vitest-environment jsdom
import { act, type ComponentType, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  highlightJsonPage: vi.fn<(code: string) => Promise<{ content: string; color?: string }[][]>>(),
}));

vi.mock("./jsonHighlightClient", () => ({
  highlightJsonPage: mocks.highlightJsonPage,
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    components,
    itemContent,
    rangeChanged,
  }: {
    components?: { Scroller?: ComponentType<Record<string, unknown>> };
    itemContent: (index: number) => React.ReactNode;
    rangeChanged: (range: { startIndex: number; endIndex: number }) => void;
  }) => {
    useEffect(() => {
      rangeChanged({ startIndex: 0, endIndex: 1 });
    }, [rangeChanged]);
    const Scroller = components?.Scroller ?? "div";
    return (
      <Scroller
        aria-label="JSON source"
        data-testid="virtuoso"
        data-virtuoso-scroller
        style={{ height: "100%", overflowY: "auto", position: "relative" }}
        tabIndex={0}
      >
        {itemContent(0)}
        {itemContent(1)}
      </Scroller>
    );
  },
}));

import { VirtualizedJsonViewer } from "./VirtualizedJsonViewer";

describe("VirtualizedJsonViewer", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    mocks.highlightJsonPage.mockReset();
    mocks.highlightJsonPage.mockImplementation(async (code) =>
      code.split("\n").map((line) => [{ content: line, color: "#abcdef" }]),
    );
  });

  afterEach(() => {
    host.remove();
  });

  it("shows plain visible lines immediately and progressively replaces them with tokens", async () => {
    const root = createRoot(host);
    act(() => root.render(<VirtualizedJsonViewer code={'{\n  "value": 1\n}'} />));

    expect(host.textContent).toContain('  "value": 1');
    expect(host.querySelector('span[style*="color"]')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(mocks.highlightJsonPage).toHaveBeenCalledTimes(1);
    expect(host.querySelector('span[style*="color"]')).toBeTruthy();
    expect(host.querySelectorAll("[data-json-line]")).toHaveLength(2);
    const viewport = host.querySelector('[data-slot="scroll-area-viewport"]');
    expect(viewport).toBeTruthy();
    expect(viewport?.hasAttribute("data-virtuoso-scroller")).toBe(true);
    expect(viewport?.closest('[data-slot="scroll-area"]')).toBeTruthy();

    act(() => root.unmount());
  });
});
