// @vitest-environment jsdom
import type { Blueprint, BlueprintDocument, RenderResult } from "fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock("fpsr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fpsr")>();
  return {
    ...actual,
    cdnAssets: vi.fn(() => ({})),
    createRenderer: vi.fn(async () => ({ render: mocks.render })),
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

function result(altMode: boolean): RenderResult {
  return {
    canvas: {} as RenderResult["canvas"],
    width: 32,
    height: 32,
    tileFrame: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    drawList: {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      commands: altMode
        ? [
            {
              kind: "icon",
              layer: 58,
              sortY: 0,
              sortX: 0,
              entity: 1,
              sub: 0,
              frame: 0,
              x: 0.5,
              y: 0.5,
              size: 0.5,
            },
          ]
        : [],
    },
    toPngBlob: vi.fn(async () => new Blob()),
    toPngBuffer: vi.fn(async () => new Uint8Array()),
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
    mocks.render.mockReset();
    mocks.render.mockImplementation(async (_doc, opts) => result(opts?.altMode === true));
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
    act(() => {
      root.render(<PreviewPane doc={doc} blueprint={blueprint} blueprintPath={null} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.render.mock.calls[0]?.[1]).toMatchObject({
      altMode: true,
      padTiles: 1,
      showCheckerboard: true,
      canvas: expect.any(HTMLCanvasElement),
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
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.render.mock.calls[1]?.[1]).toMatchObject({ altMode: false });
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
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.render.mock.calls[0]?.[1]).toMatchObject({ showCheckerboard: true });

    const toggle = host.querySelector<HTMLButtonElement>("#checkerboard");
    expect(toggle).toBeTruthy();
    act(() => {
      toggle?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.render.mock.calls[1]?.[1]).toMatchObject({ showCheckerboard: false });

    await act(async () => root.unmount());
  });
});
