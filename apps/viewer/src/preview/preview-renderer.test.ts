import { describe, expect, it, vi } from "vite-plus/test";
import type { BlueprintDocument } from "@rickyzhangca/fpsr";
import { PreviewRenderWorkerClient, renderPreview } from "./preview-renderer";
import type { RenderWorkerRequest, RenderWorkerResponse } from "./render-worker-protocol";
class FakeWorker extends EventTarget {
  readonly posts: {
    message: RenderWorkerRequest;
    transfer?: Transferable[];
  }[] = [];
  postMessage(message: RenderWorkerRequest, transfer?: Transferable[]): void {
    this.posts.push({ message, transfer });
  }
  respond(message: RenderWorkerResponse): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
  fail(message = "worker startup failed"): void {
    const event = new Event("error") as ErrorEvent;
    Object.defineProperty(event, "message", { value: message });
    this.dispatchEvent(event);
  }
}
const flushReady = async (worker: FakeWorker): Promise<void> => {
  worker.respond({ type: "ready" });
  await Promise.resolve();
};
const fakeCanvas = () => {
  const offscreen = { width: 0, height: 0 } as OffscreenCanvas;
  const transfer = vi.fn<() => OffscreenCanvas>(() => offscreen);
  return {
    offscreen,
    transfer,
    canvas: {
      transferControlToOffscreen: transfer,
    } as unknown as HTMLCanvasElement,
  };
};
const doc: BlueprintDocument = {
  blueprint: { item: "blueprint", version: 0, entities: [] },
};
describe("PreviewRenderWorkerClient", () => {
  it("measures without attaching or mutating a canvas", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    await flushReady(worker);
    const pending = client.measure(doc, { pixelsPerTile: 64, padTiles: 1 });
    await vi.waitFor(() => {
      expect(worker.posts.at(-1)?.message.type).toBe("measure");
    });
    const request = worker.posts.at(-1)?.message;
    expect(request?.type).toBe("measure");
    if (request?.type !== "measure") throw new Error("expected measure request");
    expect(worker.posts.some((post) => post.message.type === "attach")).toBe(false);
    const measurement = {
      tileFrame: { minX: 0, minY: 0, maxX: 89, maxY: 151 },
      requestedPixelsPerTile: 64,
      pixelsPerTile: 64,
      requestedWidth: 5696,
      requestedHeight: 9664,
      width: 5696,
      height: 9664,
      capped: false,
    };
    worker.respond({ type: "measured", requestId: request.requestId, measurement });
    await expect(pending).resolves.toEqual(measurement);
  });
  it("plans in the worker without attaching a canvas", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    await flushReady(worker);
    const blueprint = doc.blueprint;
    if (!blueprint) throw new Error("expected blueprint fixture");
    const pending = client.plan(blueprint, { altMode: true });
    await vi.waitFor(() => {
      expect(worker.posts.at(-1)?.message.type).toBe("plan");
    });
    const request = worker.posts.at(-1)?.message;
    if (request?.type !== "plan") throw new Error("expected plan request");
    expect(request).toMatchObject({ blueprint, options: { altMode: true } });
    expect(worker.posts.some((post) => post.message.type === "attach")).toBe(false);
    const drawList = {
      schema: 1 as const,
      commands: [],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    };
    const diagnostics = {
      entities: { total: 0, resolved: 0, unsupported: [] },
      tiles: { total: 0, resolved: 0, unsupported: [] },
      drawList: {
        commandCount: 0,
        byKind: {},
        uniqueFrames: 0,
        uniqueLayers: 0,
        atlasIndices: [],
      },
      checks: {
        finiteBounds: true,
        finiteCommands: true,
        sortedCommands: true,
        validFrameReferences: true,
      },
    };
    worker.respond({ type: "planned", requestId: request.requestId, drawList, diagnostics });
    await expect(pending).resolves.toEqual(drawList);
  });
  it("transfers a canvas once, reuses its surface, and proxies image export", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    const { canvas, offscreen, transfer } = fakeCanvas();
    const onProgress = vi.fn<(progress: { value: number; label: string }) => void>();
    const pending = client.render(canvas, doc, {
      pixelsPerTile: 64,
      profile: true,
      onProgress,
    });
    expect(onProgress).toHaveBeenLastCalledWith({ value: 2, label: "Starting worker" });
    expect(transfer).not.toHaveBeenCalled();
    expect(worker.posts).toHaveLength(0);
    await flushReady(worker);
    expect(worker.posts[0]?.message.type).toBe("attach");
    expect(worker.posts[0]?.transfer).toEqual([offscreen]);
    const renderRequest = worker.posts[1]?.message;
    expect(renderRequest?.type).toBe("render");
    if (renderRequest?.type !== "render") throw new Error("expected render request");
    expect(renderRequest.options).not.toHaveProperty("onProgress");
    worker.respond({
      type: "progress",
      requestId: renderRequest.requestId,
      surfaceId: renderRequest.surfaceId,
      progress: { value: 50, label: "Loading assets 1/2" },
    });
    expect(onProgress).toHaveBeenLastCalledWith({ value: 50, label: "Loading assets 1/2" });
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
    expect(result.width).toBe(640);
    expect(transfer).toHaveBeenCalledTimes(1);
    const blobPending = result.toImageBlob({ type: "image/webp", quality: 0.9 });
    const exportRequest = worker.posts.at(-1)?.message;
    expect(exportRequest?.type).toBe("export");
    if (exportRequest?.type !== "export") throw new Error("expected export request");
    expect(exportRequest.options).toEqual({ type: "image/webp", quality: 0.9 });
    const blob = new Blob(["webp"], { type: "image/webp" });
    worker.respond({ type: "exported", requestId: exportRequest.requestId, blob });
    expect(await blobPending).toBe(blob);
    const second = client.render(canvas, doc, { pixelsPerTile: 32 });
    await vi.waitFor(() => {
      expect(worker.posts.at(-1)?.message.type).toBe("render");
    });
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
    await flushReady(worker);
    const controller = new AbortController();
    const pending = client.render(canvas, doc, { signal: controller.signal });
    await vi.waitFor(() => {
      expect(worker.posts.at(-1)?.message.type).toBe("render");
    });
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
  it("exports a cancellable full-resolution tiled PNG without attaching a canvas", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    await flushReady(worker);
    const onProgress = vi.fn<(progress: { value: number; label: string }) => void>();
    const pending = client.exportFullResolutionPng(doc, {
      pixelsPerTile: 64,
      onProgress,
    });
    await vi.waitFor(() => {
      expect(worker.posts.at(-1)?.message.type).toBe("exportFullPng");
    });
    const request = worker.posts.at(-1)?.message;
    if (request?.type !== "exportFullPng") throw new Error("expected full PNG export request");
    expect(request.options).not.toHaveProperty("onProgress");
    expect(worker.posts.some((post) => post.message.type === "attach")).toBe(false);
    worker.respond({
      type: "progress",
      requestId: request.requestId,
      progress: { value: 51, label: "Rendering tiles 3/6" },
    });
    expect(onProgress).toHaveBeenLastCalledWith({ value: 51, label: "Rendering tiles 3/6" });
    const blob = new Blob(["png"], { type: "image/png" });
    worker.respond({
      type: "exported",
      requestId: request.requestId,
      blob,
      width: 20_000,
      height: 12_000,
      tiled: true,
    });
    await expect(pending).resolves.toEqual({
      blob,
      width: 20_000,
      height: 12_000,
      tiled: true,
    });

    const controller = new AbortController();
    const postsBeforeCancel = worker.posts.length;
    const cancelled = client.exportFullResolutionPng(doc, { signal: controller.signal });
    await vi.waitFor(() => {
      expect(worker.posts.length).toBeGreaterThan(postsBeforeCancel);
    });
    const cancelRequest = worker.posts.at(-1)?.message;
    if (cancelRequest?.type !== "exportFullPng") throw new Error("expected export request");
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.posts.at(-1)?.message).toEqual({
      type: "cancelTask",
      requestId: cancelRequest.requestId,
    });
  });
  it("opens a reusable tiled-preview session and transfers cancellable image tiles", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    await flushReady(worker);
    const sessionPending = client.openTiledPreview(doc, { altMode: true, padTiles: 1 });
    await vi.waitFor(() => {
      expect(worker.posts.at(-1)?.message.type).toBe("openTiledPreview");
    });
    const openRequest = worker.posts.at(-1)?.message;
    if (openRequest?.type !== "openTiledPreview") throw new Error("expected open request");
    const measurement = {
      tileFrame: { minX: 0, minY: 0, maxX: 32, maxY: 16 },
      requestedPixelsPerTile: 64,
      pixelsPerTile: 64,
      requestedWidth: 2048,
      requestedHeight: 1024,
      width: 2048,
      height: 1024,
      capped: false,
    };
    worker.respond({
      type: "tiledPreviewReady",
      requestId: openRequest.requestId,
      sessionId: openRequest.sessionId,
      measurement,
    });
    const session = await sessionPending;
    expect(session.measurement).toEqual(measurement);

    const tileFrame = { minX: 0, minY: 0, maxX: 16, maxY: 16 };
    const tilePending = session.renderTile(tileFrame, 32);
    const tileRequest = worker.posts.at(-1)?.message;
    if (tileRequest?.type !== "renderPreviewTile") throw new Error("expected tile request");
    expect(tileRequest).toMatchObject({
      sessionId: openRequest.sessionId,
      tileFrame,
      pixelsPerTile: 32,
    });
    const closeBitmap = vi.fn<() => void>();
    const bitmap = { close: closeBitmap } as unknown as ImageBitmap;
    worker.respond({
      type: "previewTileRendered",
      requestId: tileRequest.requestId,
      sessionId: openRequest.sessionId,
      bitmap,
      tileFrame,
      pixelsPerTile: 32,
      width: 512,
      height: 512,
    });
    await expect(tilePending).resolves.toEqual({
      bitmap,
      tileFrame,
      pixelsPerTile: 32,
      width: 512,
      height: 512,
    });
    expect(closeBitmap).not.toHaveBeenCalled();

    const controller = new AbortController();
    const cancelled = session.renderTile(tileFrame, 64, controller.signal);
    const cancelledRequest = worker.posts.at(-1)?.message;
    if (cancelledRequest?.type !== "renderPreviewTile") {
      throw new Error("expected cancellable tile request");
    }
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.posts.at(-1)?.message).toEqual({
      type: "cancelTask",
      requestId: cancelledRequest.requestId,
    });

    session.close();
    expect(worker.posts.at(-1)?.message).toEqual({
      type: "closeTiledPreview",
      sessionId: openRequest.sessionId,
    });
  });
  it("does not transfer a canvas when the worker fails before its ready handshake", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    const { canvas, transfer } = fakeCanvas();
    const pending = client.render(canvas, doc, {});
    worker.fail();
    await expect(pending).rejects.toThrow("worker startup failed");
    expect(transfer).not.toHaveBeenCalled();
    expect(worker.posts).toHaveLength(0);
  });
  it("aborts while waiting for readiness without touching the canvas", async () => {
    const worker = new FakeWorker();
    const client = new PreviewRenderWorkerClient(worker as unknown as Worker);
    const { canvas, transfer } = fakeCanvas();
    const controller = new AbortController();
    const pending = client.render(canvas, doc, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(transfer).not.toHaveBeenCalled();
    expect(worker.posts).toHaveLength(0);
  });
});
describe("renderPreview", () => {
  it("rejects unsupported environments instead of rendering on the main thread", async () => {
    const canvas = {} as HTMLCanvasElement;
    await expect(renderPreview(canvas, doc, {})).rejects.toThrow(
      "Preview rendering requires a browser with Web Workers and OffscreenCanvas support.",
    );
  });
});
