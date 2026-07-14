import {
  nowMs,
  type AssetEvent,
  type BlueprintDocument,
  type CanvasLike,
  type RenderOptions,
  type RenderProfile,
  type TileFrame,
} from "fpsr";
import type { RenderWorkerRequest, RenderWorkerResponse } from "./renderWorkerProtocol";
import {
  getAssetEventCursor,
  getAssetEventsSince,
  getSessionBlobBytes,
  getViewerRenderer,
} from "./viewerAssets";

export interface PreviewRenderResult {
  backend: "worker" | "main";
  canvas?: CanvasLike;
  width: number;
  height: number;
  tileFrame: TileFrame;
  profile?: RenderProfile;
  assetDetails: AssetEvent[];
  sessionBytes: number;
  wallMs: number;
  toPngBlob(): Promise<Blob>;
}

interface PendingRender {
  kind: "render";
  surfaceId: string;
  resolve(result: PreviewRenderResult): void;
  reject(error: Error): void;
  cleanup(): void;
}

interface PendingExport {
  kind: "export";
  resolve(blob: Blob): void;
  reject(error: Error): void;
}

type PendingRequest = PendingRender | PendingExport;

function abortError(): DOMException {
  return new DOMException("The render was aborted", "AbortError");
}

export class PreviewRenderWorkerClient {
  private readonly surfaces = new WeakMap<HTMLCanvasElement, string>();
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private nextSurfaceId = 1;

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", (event: MessageEvent<RenderWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Render worker failed");
      for (const request of this.pending.values()) {
        if (request.kind === "render") request.cleanup();
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  owns(canvas: HTMLCanvasElement): boolean {
    return this.surfaces.has(canvas);
  }

  render(
    canvas: HTMLCanvasElement,
    doc: BlueprintDocument,
    options: Omit<RenderOptions, "canvas">,
  ): Promise<PreviewRenderResult> {
    let surfaceId = this.surfaces.get(canvas);
    if (!surfaceId) {
      surfaceId = `preview-${this.nextSurfaceId++}`;
      const offscreen = canvas.transferControlToOffscreen();
      this.surfaces.set(canvas, surfaceId);
      const attach: RenderWorkerRequest = { type: "attach", surfaceId, canvas: offscreen };
      this.worker.postMessage(attach, [offscreen]);
    }

    const requestId = this.nextRequestId++;
    const signal = options.signal;
    return new Promise<PreviewRenderResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        this.pending.delete(requestId);
        const cancel: RenderWorkerRequest = { type: "cancel", requestId, surfaceId };
        this.worker.postMessage(cancel);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(requestId, {
        kind: "render",
        surfaceId,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      });
      const { signal: _signal, ...workerOptions } = options;
      const request: RenderWorkerRequest = {
        type: "render",
        requestId,
        surfaceId,
        doc,
        options: workerOptions,
      };
      this.worker.postMessage(request);
    });
  }

  clear(canvas: HTMLCanvasElement): boolean {
    const surfaceId = this.surfaces.get(canvas);
    if (!surfaceId) return false;
    const request: RenderWorkerRequest = { type: "clear", surfaceId };
    this.worker.postMessage(request);
    return true;
  }

  private export(surfaceId: string, renderId: number): Promise<Blob> {
    const requestId = this.nextRequestId++;
    return new Promise<Blob>((resolve, reject) => {
      this.pending.set(requestId, { kind: "export", resolve, reject });
      const request: RenderWorkerRequest = {
        type: "export",
        requestId,
        renderId,
        surfaceId,
      };
      this.worker.postMessage(request);
    });
  }

  private handleMessage(response: RenderWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    if (response.type === "error") {
      if (pending.kind === "render") pending.cleanup();
      const error = new Error(response.message);
      error.name = response.name;
      pending.reject(error);
      return;
    }
    if (response.type === "exported") {
      if (pending.kind === "export") pending.resolve(response.blob);
      return;
    }
    if (pending.kind !== "render") return;
    pending.cleanup();
    pending.resolve({
      backend: "worker",
      width: response.width,
      height: response.height,
      tileFrame: response.tileFrame,
      profile: response.profile,
      assetDetails: response.assetDetails,
      sessionBytes: response.sessionBytes,
      wallMs: response.wallMs,
      toPngBlob: () => this.export(pending.surfaceId, response.requestId),
    });
  }
}

let workerClient: PreviewRenderWorkerClient | undefined;

function supportsWorkerRendering(canvas: HTMLCanvasElement): boolean {
  return typeof Worker !== "undefined" && typeof canvas.transferControlToOffscreen === "function";
}

function getWorkerClient(): PreviewRenderWorkerClient {
  if (!workerClient) {
    const worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
    workerClient = new PreviewRenderWorkerClient(worker);
  }
  return workerClient;
}

export async function renderPreview(
  canvas: HTMLCanvasElement,
  doc: BlueprintDocument,
  options: Omit<RenderOptions, "canvas">,
): Promise<PreviewRenderResult> {
  if (supportsWorkerRendering(canvas)) {
    return getWorkerClient().render(canvas, doc, options);
  }

  const detailStart = getAssetEventCursor();
  const renderer = await getViewerRenderer();
  const wallStart = nowMs();
  const result = await renderer.render(doc, { ...options, canvas });
  return {
    backend: "main",
    canvas: result.canvas,
    width: result.width,
    height: result.height,
    tileFrame: result.tileFrame,
    profile: result.profile,
    assetDetails: getAssetEventsSince(detailStart),
    sessionBytes: getSessionBlobBytes(),
    wallMs: nowMs() - wallStart,
    toPngBlob: () => result.toPngBlob(),
  };
}

export function clearPreview(canvas: HTMLCanvasElement): void {
  if (workerClient?.clear(canvas)) return;
  canvas.width = 0;
  canvas.height = 0;
}
