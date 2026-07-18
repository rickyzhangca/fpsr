import {
  cdnAssets,
  createRenderer,
  nowMs,
  planDrawList,
  type AssetEvent,
  type AssetTier,
  type CanvasLike,
  type Renderer,
  type RenderResult,
} from "fpsr";
import { ASSETS_BASE, MAX_CONCURRENT_ASSET_DECODES } from "./asset-config";
import {
  toPreviewRenderProgress,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
} from "./render-worker-protocol";
import { analyzePlan } from "./plan-diagnostics";
const assetEvents: AssetEvent[] = [];
let sessionBlobBytes = 0;
const assets = cdnAssets(ASSETS_BASE, {
  maxConcurrentDecodes: MAX_CONCURRENT_ASSET_DECODES,
  onAssetEvent(event) {
    assetEvents.push(event);
    if (!event.cached && event.bytes != null) sessionBlobBytes += event.bytes;
  },
});
const rendererPromises = new Map<AssetTier, Promise<Renderer>>();
const getRenderer = (tier: AssetTier): Promise<Renderer> => {
  let pending = rendererPromises.get(tier);
  if (!pending) {
    pending = createRenderer({ assets, assetTier: tier }).catch((error) => {
      rendererPromises.delete(tier);
      throw error;
    });
    rendererPromises.set(tier, pending);
  }
  return pending;
};
interface SurfaceState {
  canvas: OffscreenCanvas;
  active?: {
    requestId: number;
    controller: AbortController;
  };
  result?: {
    requestId: number;
    result: RenderResult;
  };
}
const surfaces = new Map<string, SurfaceState>();
const workerScope = self as unknown as {
  postMessage(message: RenderWorkerResponse): void;
  onmessage: ((event: MessageEvent<RenderWorkerRequest>) => void) | null;
};
const postError = (requestId: number, error: unknown): void => {
  const value = error instanceof Error ? error : new Error(String(error));
  workerScope.postMessage({
    type: "error",
    requestId,
    name: value.name,
    message: value.message,
  });
};
const render = async (
  request: Extract<
    RenderWorkerRequest,
    {
      type: "render";
    }
  >,
): Promise<void> => {
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
    let tier: AssetTier = (request.options.pixelsPerTile ?? 64) <= 32 ? "1x" : "2x";
    if (request.options.maxOutputSize && tier === "2x") {
      const measuringRenderer = await getRenderer("2x");
      const measurement = measuringRenderer.measure(request.doc, request.options);
      if (measurement.pixelsPerTile <= 32) tier = "1x";
    }
    const renderer = await getRenderer(tier);
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
};
const measure = async (
  request: Extract<
    RenderWorkerRequest,
    {
      type: "measure";
    }
  >,
): Promise<void> => {
  try {
    const renderer = await getRenderer("2x");
    const measurement = renderer.measure(request.doc, request.options);
    workerScope.postMessage({ type: "measured", requestId: request.requestId, measurement });
  } catch (error) {
    postError(request.requestId, error);
  }
};
const plan = async (request: Extract<RenderWorkerRequest, { type: "plan" }>): Promise<void> => {
  try {
    const db = await assets.loadRenderDb();
    const drawList = planDrawList(request.blueprint, db, request.options);
    const diagnostics = analyzePlan(request.blueprint, drawList, db);
    workerScope.postMessage({
      type: "planned",
      requestId: request.requestId,
      drawList,
      diagnostics,
    });
  } catch (error) {
    postError(request.requestId, error);
  }
};
const exportImage = async (
  request: Extract<
    RenderWorkerRequest,
    {
      type: "export";
    }
  >,
): Promise<void> => {
  const surface = surfaces.get(request.surfaceId);
  if (!surface?.result || surface.result.requestId !== request.renderId) {
    postError(request.requestId, new Error("The requested render is no longer available"));
    return;
  }
  try {
    const blob = await surface.result.result.toImageBlob(request.options);
    workerScope.postMessage({ type: "exported", requestId: request.requestId, blob });
  } catch (error) {
    postError(request.requestId, error);
  }
};
workerScope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case "plan":
      void plan(request);
      break;
    case "attach":
      surfaces.set(request.surfaceId, { canvas: request.canvas });
      break;
    case "measure":
      void measure(request);
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
      void exportImage(request);
      break;
  }
};
// Signal only after the module has initialized its asset store and message handler.
// The main thread must receive this before transferring ownership of a canvas.
workerScope.postMessage({ type: "ready" });
