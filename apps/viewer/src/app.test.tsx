// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PreviewRenderProgress } from "./preview-renderer";

const mocks = vi.hoisted(() => ({
  progressCallbacks: [] as Array<(progress: PreviewRenderProgress | null) => void>,
  listCustoms: vi.fn(async () => []),
}));

vi.mock("./custom-blueprints-db", () => ({
  addCustom: vi.fn(),
  clearCustoms: vi.fn(),
  listCustoms: mocks.listCustoms,
}));
vi.mock("./sidebar-panels", () => ({ SidebarPanels: () => null }));
vi.mock("./blueprint-summary", () => ({ BlueprintSummary: () => null }));
vi.mock("./book-summary", () => ({ BookSummary: () => null }));
vi.mock("./preview-pane", () => ({
  PreviewPane: ({
    onRenderProgress,
  }: {
    onRenderProgress?: (progress: PreviewRenderProgress | null) => void;
  }) => {
    if (onRenderProgress) mocks.progressCallbacks.push(onRenderProgress);
    return null;
  },
}));

import { App } from "./app";

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
    mocks.listCustoms.mockClear();
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
});
