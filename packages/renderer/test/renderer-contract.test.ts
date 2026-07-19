import { describe, expect, it, vi } from "vite-plus/test";
import type { AssetSource } from "../src/assets.js";
import type { ImageSource } from "../src/host.js";
import { renderPreparedViewport } from "../src/internal/prepared-viewport.js";
import { createRenderer, type CanvasLike } from "../src/renderer.js";
import type { Blueprint } from "../src/types/blueprint.js";
import type { DrawList } from "../src/types/draw-list.js";
import type { RenderDb } from "../src/types/render-db.js";

function stubDb(): RenderDb {
  return {
    schema: 2,
    gameVersion: "2.1.11",
    mods: ["base"],
    assetDensity: 2,
    atlases: [{ file: "a.png", width: 1, height: 1 }],
    frames: [{ a: 0, x: 0, y: 0, w: 1, h: 1, ox: 0, oy: 0, sw: 1, sh: 1 }],
    entities: {},
    tiles: {},
    icons: {},
  };
}

function stubCanvas(width: number, height: number): CanvasLike {
  const ctx = {
    save() {},
    restore() {},
    scale() {},
    rotate() {},
    translate() {},
    fillRect() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    stroke() {},
    fill() {},
    rect() {},
    clip() {},
    drawImage() {},
    fillText() {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set globalAlpha(_v: number) {},
    get globalAlpha() {
      return 1;
    },
    set globalCompositeOperation(_v: string) {},
    get globalCompositeOperation() {
      return "source-over";
    },
    set filter(_v: string) {},
    set font(_v: string) {},
    set textBaseline(_v: string) {},
    set textAlign(_v: string) {},
    imageSmoothingEnabled: false,
  };
  return {
    width,
    height,
    getContext() {
      return ctx as never;
    },
  };
}

const bp: Blueprint = { item: "blueprint", version: 2 * 2 ** 48, entities: [] };

const tileFrame = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

const preparedDrawList: DrawList = {
  schema: 1,
  bounds: tileFrame,
  commands: [
    {
      kind: "sprite",
      frame: 0,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      layer: 20,
      sortY: 0,
      sortX: 0,
      entity: 1,
      sub: 0,
    },
  ],
};

async function paintWithSignal(
  renderer: Awaited<ReturnType<typeof createRenderer>>,
  signal: AbortSignal,
) {
  return renderPreparedViewport(renderer, bp, {
    pixelsPerTile: 32,
    tileFrame,
    outputTileFrame: tileFrame,
    preparedDrawList,
    signal,
  });
}

describe("renderer abort isolation", () => {
  it("lets either concurrent waiter abort without rejecting the other", async () => {
    let resolveAtlas!: (value: ImageSource) => void;
    const atlasPromise = new Promise<ImageSource>((resolve) => {
      resolveAtlas = resolve;
    });
    const loadAtlasImage = vi.fn<AssetSource["loadAtlasImage"]>(async () => atlasPromise);
    const assets: AssetSource = {
      async loadRenderDb() {
        return stubDb();
      },
      loadAtlasImage,
    };

    const renderer = await createRenderer({
      assets,
      createCanvas: stubCanvas,
    });

    const first = new AbortController();
    const second = new AbortController();
    const p1 = paintWithSignal(renderer, first.signal);
    const p2 = paintWithSignal(renderer, second.signal);

    expect(loadAtlasImage).toHaveBeenCalledTimes(1);
    expect(loadAtlasImage.mock.calls[0]?.at(2)).toBeUndefined();

    first.abort();
    await expect(p1).rejects.toMatchObject({ name: "AbortError" });

    resolveAtlas({});
    await expect(p2).resolves.toMatchObject({ width: expect.any(Number) });

    // Opposite order on a fresh renderer / cache miss.
    let resolveAtlas2!: (value: ImageSource) => void;
    const atlasPromise2 = new Promise<ImageSource>((resolve) => {
      resolveAtlas2 = resolve;
    });
    const loadAtlasImage2 = vi.fn<AssetSource["loadAtlasImage"]>(async () => atlasPromise2);
    const renderer2 = await createRenderer({
      assets: {
        async loadRenderDb() {
          return stubDb();
        },
        loadAtlasImage: loadAtlasImage2,
      },
      createCanvas: stubCanvas,
    });
    const a = new AbortController();
    const b = new AbortController();
    const ra = paintWithSignal(renderer2, a.signal);
    const rb = paintWithSignal(renderer2, b.signal);
    b.abort();
    await expect(rb).rejects.toMatchObject({ name: "AbortError" });
    resolveAtlas2({});
    await expect(ra).resolves.toMatchObject({ width: expect.any(Number) });
  });
});

describe("renderer dispose ownership", () => {
  it("does not dispose shared AssetSource or close source-owned atlas images", async () => {
    const close = vi.fn<() => void>();
    const atlasImage = { close } as ImageSource & { close: () => void };
    const disposeAssets = vi.fn<() => void>();
    const assets: AssetSource = {
      async loadRenderDb() {
        return stubDb();
      },
      async loadAtlasImage() {
        return atlasImage;
      },
      dispose: disposeAssets,
    };

    const renderer = await createRenderer({ assets, createCanvas: stubCanvas });
    await paintWithSignal(renderer, new AbortController().signal);
    renderer.dispose();

    expect(disposeAssets).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("prepared viewport internal API", () => {
  it("is available via internal helper but not on the public Renderer type", async () => {
    const renderer = await createRenderer({
      assets: {
        async loadRenderDb() {
          return stubDb();
        },
        async loadAtlasImage() {
          return {};
        },
      },
      createCanvas: stubCanvas,
    });

    expect("renderPreparedViewport" in renderer).toBe(false);

    const result = await renderPreparedViewport(renderer, bp, {
      pixelsPerTile: 32,
      tileFrame,
      outputTileFrame: tileFrame,
      preparedDrawList,
    });
    expect(result.width).toBeGreaterThan(0);
  });
});
