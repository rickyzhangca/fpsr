// @vitest-environment jsdom
import type { Blueprint, BlueprintDocument } from "fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  renderPreview: vi.fn(),
  clearPreview: vi.fn(),
}));

vi.mock("./previewRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./previewRenderer")>();
  return {
    ...actual,
    renderPreview: mocks.renderPreview,
    clearPreview: mocks.clearPreview,
  };
});

vi.mock("./FactorioItemIcon", () => ({
  FactorioItemIcon: ({ iconKey, quality }: { iconKey: string | string[]; quality?: string }) => {
    const key = Array.isArray(iconKey) ? iconKey[0] : iconKey;
    return <span data-testid="entity-icon" data-icon-key={key} data-quality={quality ?? ""} />;
  },
}));

vi.mock("./PreviewCanvasFrame", () => ({
  PreviewCanvasFrame: ({
    children,
    actions,
  }: {
    children: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <>
      {children}
      {actions}
    </>
  ),
}));

import { PreviewPane } from "./PreviewPane";
import type { PreviewRenderProgress, PreviewRenderResult } from "./previewRenderer";

function result(): PreviewRenderResult {
  return {
    width: 32,
    height: 32,
    tileFrame: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    profile: undefined,
    assetDetails: [],
    sessionBytes: 0,
    wallMs: 12,
    toPngBlob: vi.fn(async () => new Blob()),
  };
}

describe("PreviewPane alt-mode toggle", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    host = document.createElement("div");
    document.body.append(host);
    mocks.renderPreview.mockReset();
    mocks.clearPreview.mockReset();
    mocks.renderPreview.mockImplementation(async () => result());
  });

  afterEach(() => {
    host.remove();
  });

  it("rerenders when alt mode is toggled and exposes the latest result", async () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Alt test",
      entities: [{ entity_number: 1, name: "assembling-machine-1", position: { x: 0.5, y: 0.5 } }],
    };
    const doc: BlueprintDocument = { blueprint };
    const root = createRoot(host);
    const onRenderProgress = vi.fn<(progress: PreviewRenderProgress | null) => void>();
    act(() => {
      root.render(
        <PreviewPane
          doc={doc}
          blueprint={blueprint}
          blueprintPath={null}
          onRenderProgress={onRenderProgress}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(1);
    expect(onRenderProgress).toHaveBeenLastCalledWith({
      value: 100,
      label: "Complete",
      durationMs: expect.any(Number),
    });
    expect(mocks.renderPreview.mock.calls[0]?.[0]).toBeInstanceOf(HTMLCanvasElement);
    expect(mocks.renderPreview.mock.calls[0]?.[2]).toMatchObject({
      altMode: true,
      padTiles: 1,
      showCheckerboard: true,
      signal: expect.any(AbortSignal),
    });

    const toggle = host.querySelector<HTMLButtonElement>("#alt-mode");
    expect(toggle).toBeTruthy();
    act(() => {
      toggle?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(2);
    expect(mocks.renderPreview.mock.calls[1]?.[2]).toMatchObject({ altMode: false });
    const download = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Download",
    );
    expect(download?.disabled).toBe(false);
    const copy = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Copy PNG",
    );
    expect(copy?.disabled).toBe(false);

    await act(async () => root.unmount());
  });

  it("rerenders when checkerboard is toggled", async () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Checkerboard test",
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };
    const doc: BlueprintDocument = { blueprint };
    const root = createRoot(host);
    act(() => {
      root.render(<PreviewPane doc={doc} blueprint={blueprint} blueprintPath={null} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(1);
    expect(mocks.renderPreview.mock.calls[0]?.[2]).toMatchObject({ showCheckerboard: true });

    const toggle = host.querySelector<HTMLButtonElement>("#checkerboard");
    expect(toggle).toBeTruthy();
    act(() => {
      toggle?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(2);
    expect(mocks.renderPreview.mock.calls[1]?.[2]).toMatchObject({ showCheckerboard: false });

    await act(async () => root.unmount());
  });
});
