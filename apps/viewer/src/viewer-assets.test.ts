import type { AssetSource } from "fpsr";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const source: AssetSource = {
    loadRenderDb: vi.fn<AssetSource["loadRenderDb"]>(),
    loadAtlasImage: vi.fn<AssetSource["loadAtlasImage"]>(),
  };
  return {
    source,
    cdnAssets: vi.fn<typeof import("fpsr").cdnAssets>(),
  };
});

vi.mock("fpsr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fpsr")>();
  mocks.cdnAssets.mockReturnValue(mocks.source);
  return { ...actual, cdnAssets: mocks.cdnAssets };
});

describe("viewer asset store", () => {
  beforeEach(() => {
    mocks.cdnAssets.mockClear();
  });

  it("creates the shared UI asset source with the viewer decode limit", async () => {
    const store = await import("./viewer-assets");
    expect(store.viewerAssets).toBe(mocks.source);
    expect(mocks.cdnAssets).toHaveBeenCalledTimes(1);
    expect(mocks.cdnAssets).toHaveBeenCalledWith("/assets/2.1.11", {
      maxConcurrentDecodes: 2,
    });
  });
});
