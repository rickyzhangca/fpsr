import {
  type AssetEvent,
  type BlueprintDocument,
  type RenderOptions,
  type RenderProfile,
  type TileFrame,
} from "fpsr";
import {
  type PreviewRenderProgress,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
} from "./renderWorkerProtocol";

export interface PreviewRenderResult {
  width: number;
  height: number;
  tileFrame: TileFrame;
  profile?: RenderProfile;
  assetDetails: AssetEvent[];
  sessionBytes: number;
  wallMs: number;
  toPngBlob(): Promise<Blob>;
}

export type { PreviewRenderProgress } from "./renderWorkerProtocol";

export type PreviewRenderOptions = Omit<RenderOptions, "canvas" | "onProgress"> & {
  onProgress?: (progress: PreviewRenderProgress) => void;
};

interface PendingRender {
  kind: "render";
  surfaceId: string;
  resolve(result: PreviewRenderResult): void;
  reject(error: Error): void;
  cleanup(): void;
  onProgress?: (progress: PreviewRenderProgress) => void;
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
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private failure?: Error;
  private nextRequestId = 1;
  private nextSurfaceId = 1;

  constructor(private readonly worker: Worker) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A worker may fail before the first render starts waiting on readiness.
    // Attach a handler now while preserving the rejection for later callers.
    void this.readyPromise.catch(() => undefined);
    worker.addEventListener("message", (event: MessageEvent<RenderWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      this.fail(new Error(event.message || "Render worker failed"));
    });
  }

  async render(
    canvas: HTMLCanvasElement,
    doc: BlueprintDocument,
    options: PreviewRenderOptions,
  ): Promise<PreviewRenderResult> {
    options.onProgress?.({ value: 2, label: "Starting worker" });
    await this.waitUntilReady(options.signal);

    let surfaceId = this.surfaces.get(canvas);
    if (!surfaceId) {
      surfaceId = `preview-${this.nextSurfaceId++}`;
      const offscreen = canvas.transferControlToOffscreen();
      // Once transferControlToOffscreen succeeds this canvas cannot safely fall
      // back to main-thread rendering, even if posting the attachment fails.
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
        onProgress: options.onProgress,
      });
      const { signal: _signal, onProgress: _onProgress, ...workerOptions } = options;
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
    if (response.type === "ready") {
      if (!this.failure) this.resolveReady();
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    if (response.type === "progress") {
      if (pending.kind === "render") pending.onProgress?.(response.progress);
      return;
    }
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

  private waitUntilReady(signal?: AbortSignal): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (signal?.aborted) return Promise.reject(abortError());
    if (!signal) {
      return this.readyPromise.then(() => {
        if (this.failure) throw this.failure;
      });
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      this.readyPromise.then(
        () => {
          cleanup();
          if (this.failure) reject(this.failure);
          else resolve();
        },
        (error: Error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  private fail(error: Error): void {
    if (!this.failure) this.failure = error;
    this.rejectReady(this.failure);
    for (const request of this.pending.values()) {
      if (request.kind === "render") request.cleanup();
      request.reject(this.failure);
    }
    this.pending.clear();
  }
}

let workerClient: PreviewRenderWorkerClient | undefined;

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
  options: PreviewRenderOptions,
): Promise<PreviewRenderResult> {
  if (typeof Worker === "undefined" || typeof canvas.transferControlToOffscreen !== "function") {
    throw new Error(
      "Preview rendering requires a browser with Web Workers and OffscreenCanvas support.",
    );
  }
  return getWorkerClient().render(canvas, doc, options);
}

export function clearPreview(canvas: HTMLCanvasElement): void {
  if (workerClient?.clear(canvas)) return;
  canvas.width = 0;
  canvas.height = 0;
}
