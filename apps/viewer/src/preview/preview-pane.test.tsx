// @vitest-environment jsdom
import type { Blueprint, BlueprintDocument } from "fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PreviewPane } from "./preview-pane";
import type { PreviewRenderResult } from "./preview-renderer";
import type { PreviewRenderProgress } from "./render-worker-protocol";
const mocks = vi.hoisted(() => ({
  renderPreview: vi.fn(),
  measurePreview: vi.fn(),
  exportFullResolutionPng: vi.fn(),
  clearPreview: vi.fn(),
  clipboardWrite: vi.fn(),
  createObjectURL: vi.fn(() => "blob:test-export"),
  revokeObjectURL: vi.fn(),
  loadRenderDb: vi.fn(async () => ({
    spaceBackground: {
      planetFrame: 0,
      planets: { nauvis: 0, vulcanus: 1 },
    },
    terrainBackgrounds: {
      dirt: { patchSize: 4, frames: [0], color: [0.5, 0.4, 0.3, 1] },
      water: { patchSize: 32, frames: [0], color: [0.2, 0.3, 0.4, 1] },
      vulcanus: { patchSize: 4, frames: [0], color: [0.1, 0.15, 0.1, 1] },
      gleba: { patchSize: 4, frames: [0], color: [0.2, 0.22, 0.19, 1] },
      fulgora: { patchSize: 8, frames: [0], color: [0.4, 0.25, 0.2, 1] },
      aquilo: { patchSize: 4, frames: [0], color: [0.85, 0.9, 0.95, 1] },
    },
  })),
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
    exportFullResolutionPng: mocks.exportFullResolutionPng,
    clearPreview: mocks.clearPreview,
  };
});
vi.mock("@/shell/viewer-assets", () => ({
  viewerAssets: {
    loadRenderDb: mocks.loadRenderDb,
  },
}));
vi.mock("@/blueprint/factorio-item-icon", () => ({
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
    localStorage.clear();
    mocks.renderPreview.mockReset();
    mocks.measurePreview.mockReset();
    mocks.exportFullResolutionPng.mockReset();
    mocks.clearPreview.mockReset();
    mocks.clipboardWrite.mockReset();
    mocks.createObjectURL.mockClear();
    mocks.revokeObjectURL.mockClear();
    mocks.loadRenderDb.mockClear();
    mocks.loadRenderDb.mockResolvedValue({
      spaceBackground: {
        planetFrame: 0,
        planets: { nauvis: 0, vulcanus: 1 },
      },
      terrainBackgrounds: {
        dirt: { patchSize: 4, frames: [0], color: [0.5, 0.4, 0.3, 1] },
        water: { patchSize: 32, frames: [0], color: [0.2, 0.3, 0.4, 1] },
        vulcanus: { patchSize: 4, frames: [0], color: [0.1, 0.15, 0.1, 1] },
        gleba: { patchSize: 4, frames: [0], color: [0.2, 0.22, 0.19, 1] },
        fulgora: { patchSize: 8, frames: [0], color: [0.4, 0.25, 0.2, 1] },
        aquilo: { patchSize: 4, frames: [0], color: [0.85, 0.9, 0.95, 1] },
      },
    });
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
    mocks.exportFullResolutionPng.mockResolvedValue({
      blob: new Blob([new Uint8Array(4096)], { type: "image/png" }),
      width: 64,
      height: 64,
      tiled: true,
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
      background: { type: "auto" },
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
  it("rerenders when background mode changes", async () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Background test",
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
    expect(mocks.renderPreview.mock.calls[0]?.[2]).toMatchObject({
      background: { type: "auto" },
    });
    const backgroundSwitch = host.querySelector<HTMLButtonElement>("#background");
    expect(backgroundSwitch).toBeTruthy();
    act(() => {
      backgroundSwitch?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(2);
    expect(mocks.renderPreview.mock.calls[1]?.[2]).toMatchObject({
      background: { type: "none" },
    });
    const trigger = host.querySelector<HTMLButtonElement>("#background-mode");
    expect(trigger).toBeTruthy();
    expect(trigger?.disabled).toBe(true);
    act(() => {
      backgroundSwitch?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(3);
    expect(mocks.renderPreview.mock.calls[2]?.[2]).toMatchObject({
      background: { type: "auto" },
    });
    expect(trigger?.disabled).toBe(false);
    act(() => {
      trigger?.click();
    });
    const space = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Space",
    );
    expect(space).toBeTruthy();
    act(() => {
      space?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(4);
    expect(mocks.renderPreview.mock.calls[3]?.[2]).toMatchObject({
      background: { type: "space" },
    });
    act(() => {
      trigger?.click();
    });
    const nauvisOrbit = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Nauvis orbit",
    );
    expect(nauvisOrbit).toBeTruthy();
    act(() => {
      nauvisOrbit?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(5);
    expect(mocks.renderPreview.mock.calls[4]?.[2]).toMatchObject({
      background: { type: "space", planet: true, planetName: "nauvis" },
    });
    act(() => {
      trigger?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const vulcanusOrbit = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Vulcanus orbit",
    );
    expect(vulcanusOrbit).toBeTruthy();
    act(() => {
      vulcanusOrbit?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(6);
    expect(mocks.renderPreview.mock.calls[5]?.[2]).toMatchObject({
      background: { type: "space", planet: true, planetName: "vulcanus" },
    });
    act(() => {
      trigger?.click();
    });
    const dirt = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Dirt",
    );
    expect(dirt).toBeTruthy();
    act(() => {
      dirt?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(7);
    expect(mocks.renderPreview.mock.calls[6]?.[2]).toMatchObject({
      background: { type: "terrain", name: "dirt" },
    });
    act(() => {
      trigger?.click();
    });
    const water = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Water",
    );
    expect(water).toBeTruthy();
    act(() => {
      water?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(8);
    expect(mocks.renderPreview.mock.calls[7]?.[2]).toMatchObject({
      background: { type: "terrain", name: "water" },
    });
    // Re-selecting the current mode must not leave the UI stuck on "Rendering".
    act(() => {
      trigger?.click();
    });
    const waterAgain = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Water",
    );
    expect(waterAgain).toBeTruthy();
    act(() => {
      waterAgain?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(8);
    expect(
      [...host.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent === "Rendering",
      ),
    ).toBe(false);
    act(() => {
      trigger?.click();
    });
    const auto = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Auto",
    );
    expect(auto).toBeTruthy();
    act(() => {
      auto?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(9);
    expect(mocks.renderPreview.mock.calls[8]?.[2]).toMatchObject({
      background: { type: "auto" },
    });
    act(() => {
      trigger?.click();
    });
    const vulcanus = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
      (option) => option.textContent === "Vulcanus",
    );
    expect(vulcanus).toBeTruthy();
    act(() => {
      vulcanus?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(10);
    expect(mocks.renderPreview.mock.calls[9]?.[2]).toMatchObject({
      background: { type: "terrain", name: "vulcanus" },
    });
    await act(async () => root.unmount());
  });

  it("passes auto background for space-platform blueprints without resolving locally", async () => {
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      label: "Platform background test",
      entities: [{ entity_number: 1, name: "space-platform-hub", position: { x: 0.5, y: 0.5 } }],
      tiles: [{ name: "space-platform-foundation", position: { x: 0, y: 0 } }],
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
    expect(mocks.renderPreview.mock.calls[0]?.[2]).toMatchObject({
      background: { type: "auto" },
    });
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
    const formatSwitch = host.querySelector<HTMLInputElement>("#export-format");
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
  it("measures and exports full resolution without repainting the preview", async () => {
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
    expect(host.textContent).toContain("5696×9664px");
    expect(host.textContent).not.toContain("Large full-resolution render");
    const formatSwitch = host.querySelector<HTMLInputElement>("#export-format");
    expect(formatSwitch?.disabled).toBe(true);
    const download = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Download PNG",
    );
    expect(download?.disabled).toBe(false);
    await act(async () => {
      download?.click();
      await Promise.resolve();
    });
    expect(mocks.exportFullResolutionPng).toHaveBeenCalledTimes(1);
    expect(mocks.exportFullResolutionPng.mock.calls[0]?.[1]).toMatchObject({
      pixelsPerTile: 64,
      padTiles: 1,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
