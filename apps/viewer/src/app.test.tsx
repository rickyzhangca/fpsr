// @vitest-environment jsdom
import type { PreviewRenderProgress } from "@/preview/render-worker-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  progressCallbacks: [] as Array<(progress: PreviewRenderProgress | null) => void>,
  sidebarProps: [] as Array<{
    selectedSourceId: string;
    onSelect: (
      sourceId: string,
      path: number[],
      kind: "book" | "blueprint" | "upgrade_planner",
    ) => void;
  }>,
  listCustoms: vi.fn(async () => []),
}));

vi.mock("@/blueprint/custom-blueprints-db", () => ({
  addCustom: vi.fn(),
  clearCustoms: vi.fn(),
  listCustoms: mocks.listCustoms,
}));
vi.mock("@/sidebar/sidebar-panels", () => ({
  SidebarPanels: (props: {
    selectedSourceId: string;
    onSelect: (
      sourceId: string,
      path: number[],
      kind: "book" | "blueprint" | "upgrade_planner",
    ) => void;
  }) => {
    mocks.sidebarProps.push(props);
    return null;
  },
}));
vi.mock("@/sidebar/blueprint-summary", () => ({ BlueprintSummary: () => null }));
vi.mock("@/sidebar/book-summary", () => ({ BookSummary: () => null }));
vi.mock("@/sidebar/upgrade-planner-summary", () => ({ UpgradePlannerSummary: () => null }));
vi.mock("@/preview/preview-pane", () => ({
  PreviewPane: ({
    onRenderProgress,
  }: {
    onRenderProgress?: (progress: PreviewRenderProgress | null) => void;
  }) => {
    if (onRenderProgress) mocks.progressCallbacks.push(onRenderProgress);
    return null;
  },
}));

import { App } from "@/app";

describe("App render progress", () => {
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
    mocks.progressCallbacks.length = 0;
    mocks.sidebarProps.length = 0;
    mocks.listCustoms.mockReset();
    mocks.listCustoms.mockResolvedValue([]);
  });

  afterEach(() => {
    host.remove();
  });

  it("keeps the progress callback stable when progress updates rerender the app", async () => {
    const root = createRoot(host);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    const before = mocks.progressCallbacks.at(-1);
    expect(before).toBeTypeOf("function");

    act(() => {
      before?.({ value: 1, label: "Queued" });
    });

    expect(mocks.progressCallbacks.at(-1)).toBe(before);
    await act(async () => root.unmount());
  });

  it("does not overwrite a user selection when custom sources finish loading", async () => {
    let resolveCustoms: ((records: []) => void) | undefined;
    mocks.listCustoms.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCustoms = resolve;
        }),
    );
    localStorage.setItem(
      "fpsr-viewer:last-view",
      JSON.stringify({ sourceId: "untra-megabase", path: null, kind: "blueprint" }),
    );

    const root = createRoot(host);
    act(() => root.render(<App />));

    const sidebar = mocks.sidebarProps.at(-1);
    expect(sidebar?.selectedSourceId).toBe("untra-megabase");
    act(() => sidebar?.onSelect("esn-squeegee", [], "book"));
    expect(mocks.sidebarProps.at(-1)?.selectedSourceId).toBe("esn-squeegee");

    await act(async () => {
      resolveCustoms?.([]);
      await Promise.resolve();
    });

    expect(mocks.sidebarProps.at(-1)?.selectedSourceId).toBe("esn-squeegee");
    await act(async () => root.unmount());
  });
});
