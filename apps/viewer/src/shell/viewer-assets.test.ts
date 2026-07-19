import type { AssetSource } from "fpsr";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => {
  const source: AssetSource = {
    loadRenderDb: vi.fn<AssetSource["loadRenderDb"]>(),
    loadAtlasImage: vi.fn<AssetSource["loadAtlasImage"]>(),
    dispose: vi.fn(),
  };
  return {
    source,
    cdnAssets: vi.fn<typeof import("fpsr").cdnAssets>(),
  };
});
vi.mock("fpsr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fpsr")>();
  mocks.cdnAssets.mockImplementation(() => ({
    ...mocks.source,
    dispose: mocks.source.dispose,
  }));
  return { ...actual, cdnAssets: mocks.cdnAssets };
});
describe("viewer asset store", () => {
  beforeEach(() => {
    mocks.cdnAssets.mockClear();
    mocks.source.dispose = vi.fn();
  });
  it("creates the shared UI asset source with the local base by default", async () => {
    vi.resetModules();
    mocks.cdnAssets.mockImplementation(() => ({
      loadRenderDb: mocks.source.loadRenderDb,
      loadAtlasImage: mocks.source.loadAtlasImage,
      dispose: mocks.source.dispose,
    }));
    const store = await import("./viewer-assets");
    expect(store.getViewerAssetOrigin()).toBe("local");
    expect(mocks.cdnAssets).toHaveBeenCalledWith("/assets/2.1.11", {
      maxConcurrentDecodes: 2,
    });
    await store.viewerAssets.loadRenderDb();
    expect(mocks.source.loadRenderDb).toHaveBeenCalled();
  });
  it("switches the shared source between local and CDN bases", async () => {
    vi.resetModules();
    const dispose = vi.fn();
    mocks.cdnAssets.mockImplementation(() => ({
      loadRenderDb: mocks.source.loadRenderDb,
      loadAtlasImage: mocks.source.loadAtlasImage,
      dispose,
    }));
    const store = await import("./viewer-assets");
    store.setViewerAssetOrigin("cdn");
    expect(store.getViewerAssetOrigin()).toBe("cdn");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(mocks.cdnAssets).toHaveBeenLastCalledWith("https://fprints-data.b-cdn.net/2.1.11", {
      maxConcurrentDecodes: 2,
    });
    store.setViewerAssetOrigin("local");
    expect(store.getViewerAssetOrigin()).toBe("local");
    expect(mocks.cdnAssets).toHaveBeenLastCalledWith("/assets/2.1.11", {
      maxConcurrentDecodes: 2,
    });
  });
});
