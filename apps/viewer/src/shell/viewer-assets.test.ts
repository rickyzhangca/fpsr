// @vitest-environment jsdom
import type { AssetSource } from "@rickyzhangca/fpsr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => {
  const loadRenderDb = vi.fn<AssetSource["loadRenderDb"]>();
  const loadAtlasImage = vi.fn<AssetSource["loadAtlasImage"]>();
  const dispose = vi.fn<() => void>();
  return {
    loadRenderDb,
    loadAtlasImage,
    dispose,
    cdnAssets: vi.fn<typeof import("@rickyzhangca/fpsr").cdnAssets>(),
  };
});
vi.mock("@rickyzhangca/fpsr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rickyzhangca/fpsr")>();
  mocks.cdnAssets.mockImplementation(() => ({
    loadRenderDb: (...args) => mocks.loadRenderDb(...args),
    loadAtlasImage: (...args) => mocks.loadAtlasImage(...args),
    dispose: () => mocks.dispose(),
  }));
  return { ...actual, cdnAssets: mocks.cdnAssets };
});
describe("viewer asset store", () => {
  const originalHostname = window.location.hostname;

  const setHostname = (hostname: string) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname },
    });
  };

  beforeEach(() => {
    vi.stubEnv("VITE_FPSR_CDN_TOKEN_QUERY", "");
    mocks.cdnAssets.mockClear();
    mocks.loadRenderDb.mockClear();
    mocks.loadAtlasImage.mockClear();
    mocks.dispose.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: originalHostname },
    });
  });

  it("creates the shared UI asset source with the local base by default", async () => {
    setHostname("");
    vi.resetModules();
    mocks.cdnAssets.mockImplementation(() => ({
      loadRenderDb: (...args) => mocks.loadRenderDb(...args),
      loadAtlasImage: (...args) => mocks.loadAtlasImage(...args),
      dispose: () => mocks.dispose(),
    }));
    const store = await import("./viewer-assets");
    expect(store.getViewerAssetOrigin()).toBe("local");
    expect(mocks.cdnAssets).toHaveBeenCalledWith("/assets/2.1.11", {
      maxConcurrentDecodes: 2,
    });
    await store.viewerAssets.loadRenderDb();
    expect(mocks.loadRenderDb).toHaveBeenCalled();
  });

  it("boots on CDN when local assets are unavailable", async () => {
    setHostname("fpsr.fprints.xyz");
    vi.resetModules();
    mocks.cdnAssets.mockImplementation(() => ({
      loadRenderDb: (...args) => mocks.loadRenderDb(...args),
      loadAtlasImage: (...args) => mocks.loadAtlasImage(...args),
      dispose: () => mocks.dispose(),
    }));
    const store = await import("./viewer-assets");
    expect(store.getViewerAssetOrigin()).toBe("cdn");
    expect(mocks.cdnAssets).toHaveBeenCalledWith("https://fpsr.b-cdn.net/2.1.11", {
      maxConcurrentDecodes: 2,
    });
  });

  it("switches the shared source between local and CDN bases", async () => {
    setHostname("");
    vi.resetModules();
    const dispose = vi.fn<() => void>();
    mocks.cdnAssets.mockImplementation(() => ({
      loadRenderDb: (...args) => mocks.loadRenderDb(...args),
      loadAtlasImage: (...args) => mocks.loadAtlasImage(...args),
      dispose,
    }));
    const store = await import("./viewer-assets");
    store.setViewerAssetOrigin("cdn");
    expect(store.getViewerAssetOrigin()).toBe("cdn");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(mocks.cdnAssets).toHaveBeenLastCalledWith("https://fpsr.b-cdn.net/2.1.11", {
      maxConcurrentDecodes: 2,
    });
    store.setViewerAssetOrigin("local");
    expect(store.getViewerAssetOrigin()).toBe("local");
    expect(mocks.cdnAssets).toHaveBeenLastCalledWith("/assets/2.1.11", {
      maxConcurrentDecodes: 2,
    });
  });

  it("notifies subscribers and bumps generation when origin changes", async () => {
    setHostname("");
    vi.resetModules();
    mocks.cdnAssets.mockImplementation(() => ({
      loadRenderDb: (...args) => mocks.loadRenderDb(...args),
      loadAtlasImage: (...args) => mocks.loadAtlasImage(...args),
      dispose: () => mocks.dispose(),
    }));
    const store = await import("./viewer-assets");
    const listener = vi.fn();
    const unsubscribe = store.subscribeViewerAssetOrigin(listener);
    const before = store.getViewerAssetOriginGeneration();
    store.setViewerAssetOrigin("cdn");
    expect(listener).toHaveBeenCalledWith("cdn");
    expect(store.getViewerAssetOriginGeneration()).toBe(before + 1);
    store.setViewerAssetOrigin("cdn");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.setViewerAssetOrigin("local");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
