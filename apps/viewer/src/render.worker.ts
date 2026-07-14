import {
  cdnAssets,
  createRenderer,
  nowMs,
  type AssetEvent,
  type CanvasLike,
  type Renderer,
  type RenderResult,
} from "fpsr";
import {
  toPreviewRenderProgress,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
} from "./renderWorkerProtocol";

const ASSETS_BASE = "/assets/2.1.9";
const assetEvents: AssetEvent[] = [];
let sessionBlobBytes = 0;

const assets = cdnAssets(ASSETS_BASE, {
  maxConcurrentDecodes: 2,
  onAssetEvent(event) {
    assetEvents.push(event);
    if (!event.cached && event.bytes != null) sessionBlobBytes += event.bytes;
  },
});

let rendererPromise: Promise<Renderer> | undefined;
function getRenderer(): Promise<Renderer> {
  if (!rendererPromise) {
    rendererPromise = createRenderer({ assets }).catch((error) => {
      rendererPromise = undefined;
      throw error;
    });
  }
  return rendererPromise;
}

interface SurfaceState {
  canvas: OffscreenCanvas;
  active?: { requestId: number; controller: AbortController };
  result?: { requestId: number; result: RenderResult };
}

const surfaces = new Map<string, SurfaceState>();
const workerScope = self as unknown as {
  postMessage(message: RenderWorkerResponse): void;
  onmessage: ((event: MessageEvent<RenderWorkerRequest>) => void) | null;
};

function postError(requestId: number, error: unknown): void {
  const value = error instanceof Error ? error : new Error(String(error));
  workerScope.postMessage({
    type: "error",
    requestId,
    name: value.name,
    message: value.message,
  });
}

async function render(request: Extract<RenderWorkerRequest, { type: "render" }>): Promise<void> {
  const surface = surfaces.get(request.surfaceId);
  if (!surface) {
    postError(request.requestId, new Error(`Unknown render surface: ${request.surfaceId}`));
    return;
  }

  surface.active?.controller.abort();
  const controller = new AbortController();
  surface.active = { requestId: request.requestId, controller };
  const detailStart = assetEvents.length;

  try {
    workerScope.postMessage({
      type: "progress",
      requestId: request.requestId,
      surfaceId: request.surfaceId,
      progress: { value: 5, label: "Preparing renderer" },
    });
    const renderer = await getRenderer();
    if (controller.signal.aborted) return;
    const wallStart = nowMs();
    const result = await renderer.render(request.doc, {
      ...request.options,
      canvas: surface.canvas as unknown as CanvasLike,
      signal: controller.signal,
      onProgress(progress) {
        if (!controller.signal.aborted && surface.active?.requestId === request.requestId) {
          workerScope.postMessage({
            type: "progress",
            requestId: request.requestId,
            surfaceId: request.surfaceId,
            progress: toPreviewRenderProgress(progress),
          });
        }
      },
    });
    const wallMs = nowMs() - wallStart;
    if (controller.signal.aborted || surface.active?.requestId !== request.requestId) return;

    surface.result = { requestId: request.requestId, result };
    workerScope.postMessage({
      type: "rendered",
      requestId: request.requestId,
      surfaceId: request.surfaceId,
      width: result.width,
      height: result.height,
      tileFrame: result.tileFrame,
      profile: result.profile,
      assetDetails: assetEvents.slice(detailStart),
      sessionBytes: sessionBlobBytes,
      wallMs,
    });
  } catch (error) {
    if (!controller.signal.aborted) postError(request.requestId, error);
  } finally {
    if (surface.active?.requestId === request.requestId) surface.active = undefined;
  }
}

async function exportPng(request: Extract<RenderWorkerRequest, { type: "export" }>): Promise<void> {
  const surface = surfaces.get(request.surfaceId);
  if (!surface?.result || surface.result.requestId !== request.renderId) {
    postError(request.requestId, new Error("The requested render is no longer available"));
    return;
  }
  try {
    const blob = await surface.result.result.toPngBlob();
    workerScope.postMessage({ type: "exported", requestId: request.requestId, blob });
  } catch (error) {
    postError(request.requestId, error);
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "attach":
      surfaces.set(request.surfaceId, { canvas: request.canvas });
      break;
    case "render":
      void render(request);
      break;
    case "cancel": {
      const active = surfaces.get(request.surfaceId)?.active;
      if (active?.requestId === request.requestId) active.controller.abort();
      break;
    }
    case "clear": {
      const surface = surfaces.get(request.surfaceId);
      if (!surface) break;
      surface.active?.controller.abort();
      surface.result = undefined;
      surface.canvas.width = 1;
      surface.canvas.height = 1;
      surface.canvas.getContext("2d")?.clearRect(0, 0, 1, 1);
      break;
    }
    case "export":
      void exportPng(request);
      break;
  }
};

// Signal only after the module has initialized its asset store and message handler.
// The main thread must receive this before transferring ownership of a canvas.
workerScope.postMessage({ type: "ready" });
