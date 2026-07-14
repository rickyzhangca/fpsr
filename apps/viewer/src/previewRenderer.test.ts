import { describe, expect, it, vi } from "vite-plus/test";
import type { BlueprintDocument } from "fpsr";
import { PreviewRenderWorkerClient } from "./previewRenderer";
import type { RenderWorkerRequest, RenderWorkerResponse } from "./renderWorkerProtocol";

class FakeWorker extends EventTarget {
  readonly posts: { message: RenderWorkerRequest; transfer?: Transferable[] }[] = [];

  postMessage(message: RenderWorkerRequest, transfer?: Transferable[]): void {
    this.posts.push({ message, transfer });
  }

  respond(message: RenderWorkerResponse): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

function fakeCanvas() {
  const offscreen = { width: 0, height: 0 } as OffscreenCanvas;
  const transfer = vi.fn<() => OffscreenCanvas>(() => offscreen);
  return {
    offscreen,
    transfer,
    canvas: {
      transferControlToOffscreen: transfer,
    } as unknown as HTMLCanvasElement,
  };
}

const doc: BlueprintDocument = {
  blueprint: { item: "blueprint", version: 0, entities: [] },
};

describe("PreviewRenderWorkerClient", () => {
  it("transfers a canvas once, reuses its surface, and proxies PNG export", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    const { canvas, offscreen, transfer } = fakeCanvas();
    const pending = client.render(canvas, doc, { pixelsPerTile: 64, profile: true });

    expect(worker.posts[0]?.message.type).toBe("attach");
    expect(worker.posts[0]?.transfer).toEqual([offscreen]);
    const renderRequest = worker.posts[1]?.message;
    expect(renderRequest?.type).toBe("render");
    if (renderRequest?.type !== "render") throw new Error("expected render request");
    worker.respond({
      type: "rendered",
      requestId: renderRequest.requestId,
      surfaceId: renderRequest.surfaceId,
      width: 640,
      height: 320,
      tileFrame: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
      assetDetails: [],
      sessionBytes: 123,
      wallMs: 12,
    });

    const result = await pending;
    expect(result.backend).toBe("worker");
    expect(result.width).toBe(640);
    expect(transfer).toHaveBeenCalledTimes(1);

    const blobPending = result.toPngBlob();
    const exportRequest = worker.posts.at(-1)?.message;
    expect(exportRequest?.type).toBe("export");
    if (exportRequest?.type !== "export") throw new Error("expected export request");
    const blob = new Blob(["png"], { type: "image/png" });
    worker.respond({ type: "exported", requestId: exportRequest.requestId, blob });
    expect(await blobPending).toBe(blob);

    const second = client.render(canvas, doc, { pixelsPerTile: 32 });
    expect(transfer).toHaveBeenCalledTimes(1);
    const secondRequest = worker.posts.at(-1)?.message;
    if (secondRequest?.type !== "render") throw new Error("expected second render request");
    worker.respond({
      type: "rendered",
      requestId: secondRequest.requestId,
      surfaceId: secondRequest.surfaceId,
      width: 320,
      height: 160,
      tileFrame: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
      assetDetails: [],
      sessionBytes: 123,
      wallMs: 8,
    });
    await second;
  });

  it("forwards cancellation and rejects without waiting for the worker", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    const { canvas } = fakeCanvas();
    const controller = new AbortController();
    const pending = client.render(canvas, doc, { signal: controller.signal });
    const renderRequest = worker.posts.at(-1)?.message;
    if (renderRequest?.type !== "render") throw new Error("expected render request");

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.posts.at(-1)?.message).toEqual({
      type: "cancel",
      requestId: renderRequest.requestId,
      surfaceId: renderRequest.surfaceId,
    });
  });
});
