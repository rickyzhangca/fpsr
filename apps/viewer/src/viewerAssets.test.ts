import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const source = { loadRenderDb: vi.fn(), loadAtlasImage: vi.fn() };
  return {
    source,
    renderer: { render: vi.fn() },
    cdnAssets: vi.fn(),
    createRenderer: vi.fn(),
    emit: undefined as ((event: import("fpsr").AssetEvent) => void) | undefined,
  };
});

vi.mock("fpsr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fpsr")>();
  mocks.cdnAssets.mockImplementation((_base: string, options?: import("fpsr").CdnAssetsOptions) => {
    mocks.emit = options?.onAssetEvent;
    return mocks.source;
  });
  mocks.createRenderer.mockResolvedValue(mocks.renderer);
  return { ...actual, cdnAssets: mocks.cdnAssets, createRenderer: mocks.createRenderer };
});

describe("viewer asset store", () => {
  beforeEach(() => {
    mocks.createRenderer.mockClear();
  });

  it("shares one CDN source and renderer while retaining session telemetry", async () => {
    const store = await import("./viewerAssets");
    const first = store.getViewerRenderer();
    const second = store.getViewerRenderer();
    expect(first).toBe(second);
    await first;
    expect(mocks.cdnAssets).toHaveBeenCalledTimes(1);
    expect(mocks.createRenderer).toHaveBeenCalledTimes(1);
    expect(mocks.createRenderer).toHaveBeenCalledWith({ assets: mocks.source });

    const cursor = store.getAssetEventCursor();
    mocks.emit?.({ kind: "atlas", index: 2, cached: false, bytes: 123, totalMs: 4 });
    mocks.emit?.({ kind: "atlas", index: 2, cached: true, totalMs: 0 });
    expect(store.getAssetEventsSince(cursor)).toHaveLength(2);
    expect(store.getSessionBlobBytes()).toBe(123);
  });
});
