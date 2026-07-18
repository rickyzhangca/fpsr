import {
  type AssetEvent,
  type Blueprint,
  type BlueprintDocument,
  type DrawList,
  type RenderImageOptions,
  type RenderOptions,
  type RenderMeasurement,
  type RenderProfile,
  type TileFrame,
} from "fpsr";
import {
  type PreviewRenderProgress,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
  type WorkerPlanOptions,
  type WorkerRenderOptions,
  type WorkerTiledPreviewOptions,
} from "./render-worker-protocol";
import type { PreviewTilePixelsPerTile } from "./preview-tiles";
import type { PlanDiagnostics } from "@/process/plan-diagnostics";
export interface PreviewRenderResult {
  width: number;
  height: number;
  tileFrame: TileFrame;
  profile?: RenderProfile;
  assetDetails: AssetEvent[];
  sessionBytes: number;
  wallMs: number;
  toImageBlob(options: RenderImageOptions): Promise<Blob>;
  toPngBlob(): Promise<Blob>;
}
export interface PreviewPlanResult {
  drawList: DrawList;
  diagnostics: PlanDiagnostics;
}
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
interface PendingFullExport {
  kind: "full-export";
  resolve(result: FullResolutionPngResult): void;
  reject(error: Error): void;
  cleanup(): void;
  onProgress?: (progress: PreviewRenderProgress) => void;
}
interface PendingTiledPreview {
  kind: "tiled-preview";
  sessionId: string;
  resolve(session: TiledPreviewSession): void;
  reject(error: Error): void;
}
interface PendingPreviewTile {
  kind: "preview-tile";
  sessionId: string;
  resolve(result: PreviewTileResult): void;
  reject(error: Error): void;
  cleanup(): void;
}
interface PendingMeasure {
  kind: "measure";
  resolve(measurement: RenderMeasurement): void;
  reject(error: Error): void;
}
interface PendingPlan {
  kind: "plan";
  resolve(result: PreviewPlanResult): void;
  reject(error: Error): void;
}
type PendingRequest =
  | PendingRender
  | PendingExport
  | PendingFullExport
  | PendingTiledPreview
  | PendingPreviewTile
  | PendingMeasure
  | PendingPlan;

export interface FullResolutionPngResult {
  blob: Blob;
  width: number;
  height: number;
  tiled: boolean;
}

export type FullResolutionPngOptions = WorkerRenderOptions & {
  signal?: AbortSignal;
  onProgress?: (progress: PreviewRenderProgress) => void;
};
export interface PreviewTileResult {
  bitmap: ImageBitmap;
  tileFrame: TileFrame;
  pixelsPerTile: PreviewTilePixelsPerTile;
  width: number;
  height: number;
}
export interface TiledPreviewSession {
  readonly sessionId: string;
  readonly measurement: RenderMeasurement;
  renderTile(
    tileFrame: TileFrame,
    pixelsPerTile: PreviewTilePixelsPerTile,
    signal?: AbortSignal,
  ): Promise<PreviewTileResult>;
  close(): void;
}
const abortError = (): DOMException => {
  return new DOMException("The render was aborted", "AbortError");
};
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
  async measure(doc: BlueprintDocument, options: WorkerRenderOptions): Promise<RenderMeasurement> {
    await this.waitUntilReady();
    const requestId = this.nextRequestId++;
    return new Promise<RenderMeasurement>((resolve, reject) => {
      this.pending.set(requestId, { kind: "measure", resolve, reject });
      const request: RenderWorkerRequest = { type: "measure", requestId, doc, options };
      this.worker.postMessage(request);
    });
  }
  async plan(blueprint: Blueprint, options: WorkerPlanOptions): Promise<DrawList> {
    return (await this.planWithDiagnostics(blueprint, options)).drawList;
  }
  async exportFullResolutionPng(
    doc: BlueprintDocument,
    options: FullResolutionPngOptions,
  ): Promise<FullResolutionPngResult> {
    options.onProgress?.({ value: 2, label: "Starting export worker" });
    await this.waitUntilReady(options.signal);
    const requestId = this.nextRequestId++;
    const signal = options.signal;
    return new Promise<FullResolutionPngResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        this.pending.delete(requestId);
        this.worker.postMessage({ type: "cancelTask", requestId } satisfies RenderWorkerRequest);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const { signal: _signal, onProgress: _onProgress, ...workerOptions } = options;
      this.pending.set(requestId, {
        kind: "full-export",
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
        onProgress: options.onProgress,
      });
      this.worker.postMessage({
        type: "exportFullPng",
        requestId,
        doc,
        options: workerOptions,
      } satisfies RenderWorkerRequest);
    });
  }
  async openTiledPreview(
    doc: BlueprintDocument,
    options: WorkerTiledPreviewOptions,
  ): Promise<TiledPreviewSession> {
    await this.waitUntilReady();
    const requestId = this.nextRequestId++;
    const sessionId = `tiles-${this.nextSurfaceId++}`;
    return new Promise<TiledPreviewSession>((resolve, reject) => {
      this.pending.set(requestId, {
        kind: "tiled-preview",
        sessionId,
        resolve,
        reject,
      });
      this.worker.postMessage({
        type: "openTiledPreview",
        requestId,
        sessionId,
        doc,
        options,
      } satisfies RenderWorkerRequest);
    });
  }
  async planWithDiagnostics(
    blueprint: Blueprint,
    options: WorkerPlanOptions,
  ): Promise<PreviewPlanResult> {
    await this.waitUntilReady();
    const requestId = this.nextRequestId++;
    return new Promise<PreviewPlanResult>((resolve, reject) => {
      this.pending.set(requestId, { kind: "plan", resolve, reject });
      const request: RenderWorkerRequest = { type: "plan", requestId, blueprint, options };
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
  private renderPreviewTile(
    sessionId: string,
    tileFrame: TileFrame,
    pixelsPerTile: PreviewTilePixelsPerTile,
    signal?: AbortSignal,
  ): Promise<PreviewTileResult> {
    const requestId = this.nextRequestId++;
    return new Promise<PreviewTileResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        this.pending.delete(requestId);
        this.worker.postMessage({ type: "cancelTask", requestId } satisfies RenderWorkerRequest);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(requestId, {
        kind: "preview-tile",
        sessionId,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      });
      this.worker.postMessage({
        type: "renderPreviewTile",
        requestId,
        sessionId,
        tileFrame,
        pixelsPerTile,
      } satisfies RenderWorkerRequest);
    });
  }
  private closeTiledPreview(sessionId: string): void {
    this.worker.postMessage({ type: "closeTiledPreview", sessionId } satisfies RenderWorkerRequest);
  }
  private export(surfaceId: string, renderId: number, options: RenderImageOptions): Promise<Blob> {
    const requestId = this.nextRequestId++;
    return new Promise<Blob>((resolve, reject) => {
      this.pending.set(requestId, { kind: "export", resolve, reject });
      const request: RenderWorkerRequest = {
        type: "export",
        requestId,
        renderId,
        surfaceId,
        options,
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
    if (!pending) {
      if (response.type === "previewTileRendered") response.bitmap.close();
      return;
    }
    if (response.type === "progress") {
      if (pending.kind === "render") pending.onProgress?.(response.progress);
      if (pending.kind === "full-export") pending.onProgress?.(response.progress);
      return;
    }
    this.pending.delete(response.requestId);
    if (response.type === "error") {
      if (
        pending.kind === "render" ||
        pending.kind === "full-export" ||
        pending.kind === "preview-tile"
      ) {
        pending.cleanup();
      }
      const error = new Error(response.message);
      error.name = response.name;
      pending.reject(error);
      return;
    }
    if (response.type === "exported") {
      if (pending.kind === "export") pending.resolve(response.blob);
      if (pending.kind === "full-export") {
        pending.cleanup();
        pending.resolve({
          blob: response.blob,
          width: response.width ?? 0,
          height: response.height ?? 0,
          tiled: response.tiled === true,
        });
      }
      return;
    }
    if (response.type === "tiledPreviewReady") {
      if (pending.kind === "tiled-preview") {
        const sessionId = pending.sessionId;
        pending.resolve({
          sessionId,
          measurement: response.measurement,
          renderTile: (tileFrame, pixelsPerTile, signal) =>
            this.renderPreviewTile(sessionId, tileFrame, pixelsPerTile, signal),
          close: () => this.closeTiledPreview(sessionId),
        });
      }
      return;
    }
    if (response.type === "previewTileRendered") {
      if (pending.kind === "preview-tile") {
        pending.cleanup();
        pending.resolve({
          bitmap: response.bitmap,
          tileFrame: response.tileFrame,
          pixelsPerTile: response.pixelsPerTile,
          width: response.width,
          height: response.height,
        });
      } else {
        response.bitmap.close();
      }
      return;
    }
    if (response.type === "measured") {
      if (pending.kind === "measure") pending.resolve(response.measurement);
      return;
    }
    if (response.type === "planned") {
      if (pending.kind === "plan") {
        pending.resolve({ drawList: response.drawList, diagnostics: response.diagnostics });
      }
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
      toImageBlob: (options) => this.export(pending.surfaceId, response.requestId, options),
      toPngBlob: () => this.export(pending.surfaceId, response.requestId, { type: "image/png" }),
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
      if (
        request.kind === "render" ||
        request.kind === "full-export" ||
        request.kind === "preview-tile"
      ) {
        request.cleanup();
      }
      request.reject(this.failure);
    }
    this.pending.clear();
  }
}
let workerClient: PreviewRenderWorkerClient | undefined;
const getWorkerClient = (): PreviewRenderWorkerClient => {
  if (!workerClient) {
    const worker = new Worker(new URL("./render.worker", import.meta.url), { type: "module" });
    workerClient = new PreviewRenderWorkerClient(worker);
  }
  return workerClient;
};
export const renderPreview = async (
  canvas: HTMLCanvasElement,
  doc: BlueprintDocument,
  options: PreviewRenderOptions,
): Promise<PreviewRenderResult> => {
  if (typeof Worker === "undefined" || typeof canvas.transferControlToOffscreen !== "function") {
    throw new Error(
      "Preview rendering requires a browser with Web Workers and OffscreenCanvas support.",
    );
  }
  return getWorkerClient().render(canvas, doc, options);
};
export const measurePreview = async (
  doc: BlueprintDocument,
  options: WorkerRenderOptions,
): Promise<RenderMeasurement> => {
  if (typeof Worker === "undefined") {
    throw new Error("Preview measurement requires a browser with Web Workers support.");
  }
  return getWorkerClient().measure(doc, options);
};
export const planPreview = async (
  blueprint: Blueprint,
  options: WorkerPlanOptions = {},
): Promise<DrawList> => {
  if (typeof Worker === "undefined") {
    throw new Error("Preview planning requires a browser with Web Workers support.");
  }
  return getWorkerClient().plan(blueprint, options);
};
export const planPreviewWithDiagnostics = async (
  blueprint: Blueprint,
  options: WorkerPlanOptions = {},
): Promise<PreviewPlanResult> => {
  if (typeof Worker === "undefined") {
    throw new Error("Preview planning requires a browser with Web Workers support.");
  }
  return getWorkerClient().planWithDiagnostics(blueprint, options);
};
export const exportFullResolutionPng = async (
  doc: BlueprintDocument,
  options: FullResolutionPngOptions,
): Promise<FullResolutionPngResult> => {
  if (typeof Worker === "undefined") {
    throw new Error("Full-resolution export requires a browser with Web Workers support.");
  }
  return getWorkerClient().exportFullResolutionPng(doc, options);
};
export const openTiledPreview = async (
  doc: BlueprintDocument,
  options: WorkerTiledPreviewOptions,
): Promise<TiledPreviewSession> => {
  if (typeof Worker === "undefined") {
    throw new Error("Tiled preview requires a browser with Web Workers support.");
  }
  return getWorkerClient().openTiledPreview(doc, options);
};
export const clearPreview = (canvas: HTMLCanvasElement): void => {
  if (workerClient?.clear(canvas)) return;
  canvas.width = 0;
  canvas.height = 0;
};
