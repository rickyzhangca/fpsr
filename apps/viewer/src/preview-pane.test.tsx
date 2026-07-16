// @vitest-environment jsdom
import type { Blueprint, BlueprintDocument } from "fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({
  renderPreview: vi.fn(),
  measurePreview: vi.fn(),
  clearPreview: vi.fn(),
  clipboardWrite: vi.fn(),
  createObjectURL: vi.fn(() => "blob:test-export"),
  revokeObjectURL: vi.fn(),
}));
class ClipboardItemMock {
  static supports = vi.fn(() => true);
  constructor(readonly items: Record<string, Blob>) {}
}
vi.mock("./preview-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./preview-renderer")>();
  return {
    ...actual,
    renderPreview: mocks.renderPreview,
    measurePreview: mocks.measurePreview,
    clearPreview: mocks.clearPreview,
  };
});
vi.mock("./factorio-item-icon", () => ({
  FactorioItemIcon: ({ iconKey, quality }: { iconKey: string | string[]; quality?: string }) => {
    const key = Array.isArray(iconKey) ? iconKey[0] : iconKey;
    return <span data-testid="entity-icon" data-icon-key={key} data-quality={quality ?? ""} />;
  },
}));
vi.mock("./preview-canvas-frame", () => ({
  PreviewCanvasFrame: ({
    children,
    actions,
    overlay,
  }: {
    children: React.ReactNode;
    actions?: React.ReactNode;
    overlay?: React.ReactNode;
  }) => (
    <>
      {children}
      {overlay}
      {actions}
    </>
  ),
}));
import { PreviewPane } from "./preview-pane";
import type { PreviewRenderProgress, PreviewRenderResult } from "./preview-renderer";
const result = (): PreviewRenderResult => {
  return {
    width: 32,
    height: 32,
    tileFrame: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    profile: undefined,
    assetDetails: [],
    sessionBytes: 0,
    wallMs: 12,
    toImageBlob: vi.fn(async (options) => new Blob([new Uint8Array(2048)], { type: options.type })),
    toPngBlob: vi.fn(async () => new Blob()),
  };
};
describe("PreviewPane alt-mode toggle", () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    host = document.createElement("div");
    document.body.append(host);
    mocks.renderPreview.mockReset();
    mocks.measurePreview.mockReset();
    mocks.clearPreview.mockReset();
    mocks.clipboardWrite.mockReset();
    mocks.createObjectURL.mockClear();
    mocks.revokeObjectURL.mockClear();
    ClipboardItemMock.supports.mockClear();
    mocks.renderPreview.mockImplementation(async () => result());
    mocks.measurePreview.mockResolvedValue({
      tileFrame: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      requestedPixelsPerTile: 64,
      pixelsPerTile: 64,
      requestedWidth: 64,
      requestedHeight: 64,
      width: 64,
      height: 64,
      capped: false,
    });
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: mocks.createObjectURL,
      revokeObjectURL: mocks.revokeObjectURL,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: mocks.clipboardWrite },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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
      pixelsPerTile: 64,
      maxOutputSize: { width: 4096, height: 4096 },
      padTiles: 1,
      showCheckerboard: true,
      signal: expect.any(AbortSignal),
    });
    const toggle = host.querySelector<HTMLButtonElement>("#alt-mode");
    expect(toggle).toBeTruthy();
    act(() => {
      toggle?.click();
    });
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(2);
    expect(mocks.renderPreview.mock.calls[1]?.[2]).toMatchObject({ altMode: false });
    const download = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Download 2.0 KB",
    );
    expect(download?.disabled).toBe(false);
    const copy = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Copy WebP",
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
  it("prepares the selected format once for sized downloads and matching clipboard copies", async () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Format test",
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };
    const doc: BlueprintDocument = { blueprint };
    const rendered = result();
    let resolvePng: ((blob: Blob) => void) | undefined;
    const pngBlob = new Blob([new Uint8Array(1.5 * 1024 * 1024)], { type: "image/png" });
    const pngPromise = new Promise<Blob>((resolve) => {
      resolvePng = resolve;
    });
    const toImageBlob = vi.fn((options: { type?: string }) => {
      if (options.type === "image/png") return pngPromise;
      return Promise.resolve(new Blob([new Uint8Array(2048)], { type: options.type }));
    });
    rendered.toImageBlob = toImageBlob;
    mocks.renderPreview.mockResolvedValue(rendered);
    const root = createRoot(host);
    const findButton = (text: string) =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === text,
      );
    act(() => {
      root.render(<PreviewPane doc={doc} blueprint={blueprint} blueprintPath={null} />);
    });
    expect(findButton("Rendering")?.disabled).toBe(true);
    expect(
      [...host.querySelectorAll<HTMLButtonElement>("button")].some((button) =>
        button.textContent?.includes("Download …"),
      ),
    ).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    const formatInput = host.querySelector<HTMLInputElement>("#export-format");
    const formatSwitch = host.querySelector<HTMLButtonElement>(
      '[data-slot="switch"][aria-label="Use WebP image format"]',
    );
    expect(formatInput?.checked).toBe(true);
    expect(findButton("Download 2.0 KB")?.disabled).toBe(false);
    const copyWebp = findButton("Copy WebP");
    expect(copyWebp).toBeTruthy();
    expect(toImageBlob).toHaveBeenCalledTimes(1);
    expect(toImageBlob).toHaveBeenLastCalledWith({ type: "image/webp", quality: 0.9 });
    await act(async () => {
      copyWebp?.click();
    });
    expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1);
    const webpClipboardItem = mocks.clipboardWrite.mock.calls[0]?.[0]?.[0] as
      | ClipboardItemMock
      | undefined;
    expect(webpClipboardItem?.items["image/webp"]?.type).toBe("image/webp");
    expect(toImageBlob).toHaveBeenCalledTimes(1);
    act(() => {
      formatSwitch?.click();
    });
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('[data-slot="switch"]')].every((switchEl) =>
        switchEl.hasAttribute("data-disabled"),
      ),
    ).toBe(true);
    expect(findButton("Encoding")?.disabled).toBe(true);
    await act(async () => {
      resolvePng?.(pngBlob);
      await pngPromise;
    });
    expect(formatInput?.checked).toBe(false);
    expect(toImageBlob).toHaveBeenLastCalledWith({ type: "image/png" });
    expect(findButton("Download 1.5 MB")?.disabled).toBe(false);
    expect(findButton("Copy PNG")).toBeTruthy();
    expect(mocks.renderPreview).toHaveBeenCalledTimes(1);
    expect(toImageBlob).toHaveBeenCalledTimes(2);
    act(() => {
      formatSwitch?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(formatInput?.checked).toBe(true);
    expect(findButton("Download 2.0 KB")?.disabled).toBe(false);
    expect(findButton("Copy WebP")).toBeTruthy();
    expect(toImageBlob).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });
  it("preflights an oversized full-resolution render before painting", async () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Large blueprint",
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };
    const doc: BlueprintDocument = { blueprint };
    mocks.measurePreview.mockResolvedValue({
      tileFrame: { minX: 0, minY: 0, maxX: 89, maxY: 151 },
      requestedPixelsPerTile: 64,
      pixelsPerTile: 64,
      requestedWidth: 5696,
      requestedHeight: 9664,
      width: 5696,
      height: 9664,
      capped: false,
    });
    const root = createRoot(host);
    act(() => {
      root.render(<PreviewPane doc={doc} blueprint={blueprint} blueprintPath={null} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(1);
    const limitSwitch = host.querySelector<HTMLButtonElement>("#limit-to-4k");
    act(() => {
      limitSwitch?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.measurePreview).toHaveBeenCalledTimes(1);
    expect(mocks.renderPreview).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Large full-resolution render");
    expect(host.textContent).toContain("5,696×9,664");
    const proceed = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Proceed with full res",
    );
    expect(proceed).toBeTruthy();
    act(() => {
      proceed?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.measurePreview).toHaveBeenCalledTimes(2);
    expect(mocks.renderPreview).toHaveBeenCalledTimes(2);
    expect(mocks.renderPreview.mock.calls[1]?.[2]).toMatchObject({
      pixelsPerTile: 64,
      maxOutputSize: undefined,
    });
    expect(host.textContent).not.toContain("Large full-resolution render");
    await act(async () => root.unmount());
  });
});
