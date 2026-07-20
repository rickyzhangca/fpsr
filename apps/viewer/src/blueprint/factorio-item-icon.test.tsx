// @vitest-environment jsdom
import type { RenderDb } from "@rickyzhangca/fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  loadRenderDb: vi.fn<() => Promise<RenderDb>>(),
  loadAtlasImage: vi.fn<() => Promise<CanvasImageSource>>(),
  getViewerAssetOrigin: vi.fn<() => "local" | "cdn">(() => "local"),
  subscribeViewerAssetOrigin: vi.fn<(listener: (next: "local" | "cdn") => void) => () => void>(),
  setViewerAssetOrigin: vi.fn<(next: "local" | "cdn") => void>(),
}));

vi.mock("@/shell/viewer-assets", () => {
  const listeners = new Set<(next: "local" | "cdn") => void>();
  let origin: "local" | "cdn" = "local";
  mocks.subscribeViewerAssetOrigin.mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  mocks.getViewerAssetOrigin.mockImplementation(() => origin);
  mocks.setViewerAssetOrigin.mockImplementation((next) => {
    if (next === origin) return;
    origin = next;
    for (const listener of listeners) listener(next);
  });
  return {
    viewerAssets: {
      loadRenderDb: (...args: unknown[]) => mocks.loadRenderDb(...(args as [])),
      loadAtlasImage: (...args: unknown[]) => mocks.loadAtlasImage(...(args as [])),
    },
    getViewerAssetOrigin: () => mocks.getViewerAssetOrigin(),
    subscribeViewerAssetOrigin: (listener: (next: "local" | "cdn") => void) =>
      mocks.subscribeViewerAssetOrigin(listener),
    setViewerAssetOrigin: (next: "local" | "cdn") => mocks.setViewerAssetOrigin(next),
  };
});

import { setViewerAssetOrigin } from "@/shell/viewer-assets";
import { clearFactorioItemIconCache, FactorioItemIcon, loadIcon } from "./factorio-item-icon";

const FRAME = { a: 0, x: 0, y: 0, w: 16, h: 16, sw: 16, sh: 16, ox: 0, oy: 0 };

const successfulDb = (): RenderDb =>
  ({
    icons: { "item/blueprint": 0 },
    frames: [FRAME],
  }) as unknown as RenderDb;

describe("FactorioItemIcon asset loading", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    clearFactorioItemIconCache();
    mocks.loadRenderDb.mockReset();
    mocks.loadAtlasImage.mockReset();
    mocks.setViewerAssetOrigin("local");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ok");
  });

  afterEach(() => {
    host.remove();
    clearFactorioItemIconCache();
    vi.restoreAllMocks();
  });

  it("retries after a failed load instead of caching null", async () => {
    mocks.loadRenderDb.mockRejectedValueOnce(new Error("404"));
    expect(await loadIcon("item/blueprint", undefined)).toBeNull();

    mocks.loadRenderDb.mockResolvedValueOnce(successfulDb());
    mocks.loadAtlasImage.mockResolvedValueOnce({} as CanvasImageSource);
    const loaded = await loadIcon("item/blueprint", undefined);
    expect(loaded?.url).toBe("data:image/png;base64,ok");
    expect(mocks.loadRenderDb).toHaveBeenCalledTimes(2);
  });

  it("reloads when the viewer asset origin switches to CDN", async () => {
    mocks.loadRenderDb.mockRejectedValueOnce(new Error("local 404"));
    const root = createRoot(host);
    await act(async () => {
      root.render(<FactorioItemIcon iconKey="item/blueprint" iconSize={40} title="blueprint" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[aria-hidden="true"]')).toBeTruthy();

    mocks.loadRenderDb.mockResolvedValue(successfulDb());
    mocks.loadAtlasImage.mockResolvedValue({} as CanvasImageSource);
    await act(async () => {
      setViewerAssetOrigin("cdn");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,ok");
    act(() => root.unmount());
  });
});
