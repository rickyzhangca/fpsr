// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import smokeBlueprint from "../../../fixtures/golden/smoke.bp.txt?raw";

const mocks = vi.hoisted(() => ({
  blit: vi.fn(),
  renderPreview: vi.fn(),
  closeBitmap: vi.fn(),
}));

vi.mock("fpsr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fpsr")>();
  return { ...actual, blitWithTileCheckerboard: mocks.blit };
});

vi.mock("./preview-renderer", () => ({
  renderPreview: mocks.renderPreview,
}));

import { ComparePane } from "./compare-pane";

describe("ComparePane", () => {
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
    mocks.blit.mockReset();
    mocks.renderPreview.mockReset();
    mocks.closeBitmap.mockReset();
    mocks.renderPreview.mockResolvedValue({
      width: 64,
      height: 64,
      toPngBlob: vi.fn().mockResolvedValue(new Blob()),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "/golden/cases.json") {
          return {
            ok: true,
            json: async () => [{ name: "smoke", bp: "smoke.bp.txt", ppt: 64 }],
          };
        }
        if (url === "/ground-truth/smoke.game.png" && init?.method === "HEAD") {
          return { ok: false };
        }
        if (url === "/golden/smoke.bp.txt") {
          return { ok: true, text: async () => smokeBlueprint };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close: mocks.closeBitmap })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    host.remove();
  });

  it("decodes and renders a selected golden case exactly once", async () => {
    const root = createRoot(host);
    act(() => root.render(<ComparePane caseName="smoke" />));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.renderPreview).toHaveBeenCalledTimes(1);

    const [canvas, doc, options] = mocks.renderPreview.mock.calls[0] ?? [];
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(doc).toMatchObject({ blueprint: { item: "blueprint" } });
    expect(options).toMatchObject({
      pixelsPerTile: 64,
      altMode: true,
      background: null,
      showCheckerboard: true,
      signal: expect.any(AbortSignal),
    });
    expect(host.textContent).toContain("smoke");
    expect(mocks.closeBitmap).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
