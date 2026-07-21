// @vitest-environment jsdom
import type { PreviewRenderProgress } from "@/preview/render-worker-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const SAMPLE_BLUEPRINT =
  "0eNpNjDEKAjEQRa8iv46ihU1KT2BhJyIJTBFIJiEzKy4hd3dWG6vPf/DeQMwLtZ5Y4QeSUoH/Yw45RMrGbiS6u1yNvKhLqgx/dCDWpIkE/j5+Z33yUiJ1+JMDh0Lmag8srXbdW2uLtiqmbY2Bt4UOZ4f1u3M+5vwAEDsyQw==";

const mocks = vi.hoisted(() => ({
  progressCallbacks: [] as Array<(progress: PreviewRenderProgress | null) => void>,
  sidebarProps: [] as Array<{
    selectedSourceId: string;
    customSources: Array<{ id: string; raw?: string }>;
    onSelect: (
      sourceId: string,
      path: number[],
      kind: "book" | "blueprint" | "upgrade_planner" | "deconstruction_planner",
    ) => void;
  }>,
  listCustoms: vi.fn(async () => []),
  addCustom: vi.fn(async (raw: string) => ({
    id: "custom-from-source",
    raw,
    createdAt: 1,
  })),
}));

vi.mock("@/blueprint/custom-blueprints-db", () => ({
  addCustom: mocks.addCustom,
  clearCustoms: vi.fn(),
  listCustoms: mocks.listCustoms,
}));
vi.mock("@/sidebar/sidebar-panels", () => ({
  SidebarPanels: (props: {
    selectedSourceId: string;
    customSources: Array<{ id: string; raw?: string }>;
    onSelect: (
      sourceId: string,
      path: number[],
      kind: "book" | "blueprint" | "upgrade_planner" | "deconstruction_planner",
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
    mocks.addCustom.mockReset();
    mocks.addCustom.mockImplementation(async (raw: string) => ({
      id: "custom-from-source",
      raw,
      createdAt: 1,
    }));
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
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

  it("loads ?source= via the proxy into Custom and strips the query", async () => {
    const sourceUrl = "https://www.factorio.school/api/blueprintData/abc/";
    window.history.replaceState(null, "", `/?source=${encodeURIComponent(sourceUrl)}`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(href).toBe(`/api/fetch-blueprint?url=${encodeURIComponent(sourceUrl)}`);
      return new Response(SAMPLE_BLUEPRINT, { status: 200 });
    });

    const root = createRoot(host);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(mocks.addCustom).toHaveBeenCalledWith(SAMPLE_BLUEPRINT);
    expect(mocks.sidebarProps.at(-1)?.selectedSourceId).toBe("custom-from-source");
    expect(
      mocks.sidebarProps.at(-1)?.customSources.some((s) => s.id === "custom-from-source"),
    ).toBe(true);
    expect(window.location.search).not.toContain("source=");
    await act(async () => root.unmount());
  });

  it("strips ?source= when the proxy fails", async () => {
    const sourceUrl = "https://www.factorio.school/api/blueprintData/missing/";
    window.history.replaceState(null, "", `/?source=${encodeURIComponent(sourceUrl)}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Upstream returned 404.", { status: 502 }),
    );

    const root = createRoot(host);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.addCustom).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("source=");
    await act(async () => root.unmount());
  });
});
