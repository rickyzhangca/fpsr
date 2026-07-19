import { ASSETS_BASE, MAX_CONCURRENT_ASSET_DECODES } from "@/shell/asset-config";
import {
  cdnAssets,
  computeTileFrame,
  createRenderer,
  measureTileFrame,
  selectBlueprint,
  type AssetEvent,
  type AssetTier,
  type CanvasLike,
  type Renderer,
  type RenderResult,
  type TileFrame,
} from "fpsr";
import { nowMs } from "fpsr/canvas";
import { analyzePlan, drawListForTile, planDrawList } from "fpsr/planner";
import { renderPreparedViewport } from "fpsr-internal/prepared-viewport";
import {
  toPreviewRenderProgress,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
} from "./render-worker-protocol";
import { createTiledPreviewTierPlanCache, type TiledPreviewTierPlan } from "./tiled-preview-plan";
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
const activeTasks = new Map<number, AbortController>();
const activeTaskSessions = new Map<number, string>();
interface TiledPreviewSession {
  doc: Extract<RenderWorkerRequest, { type: "openTiledPreview" }>["doc"];
  options: Extract<RenderWorkerRequest, { type: "openTiledPreview" }>["options"];
  getTierPlan(tier: AssetTier): Promise<TiledPreviewTierPlan>;
  tileFrame: TileFrame;
}
const tiledPreviewSessions = new Map<string, TiledPreviewSession>();
const workerScope = self as unknown as {
  postMessage(message: RenderWorkerResponse, transfer?: Transferable[]): void;
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
const exportFullPng = async (
  request: Extract<RenderWorkerRequest, { type: "exportFullPng" }>,
): Promise<void> => {
  const controller = new AbortController();
  activeTasks.set(request.requestId, controller);
  try {
    const tier: AssetTier = (request.options.pixelsPerTile ?? 64) <= 32 ? "1x" : "2x";
    const renderer = await getRenderer(tier);
    if (controller.signal.aborted) return;
    const result = await renderer.renderTiledPng(request.doc, {
      ...request.options,
      signal: controller.signal,
      onProgress(progress) {
        if (controller.signal.aborted) return;
        workerScope.postMessage({
          type: "progress",
          requestId: request.requestId,
          progress: toPreviewRenderProgress(progress),
        });
      },
    });
    if (controller.signal.aborted) return;
    workerScope.postMessage({
      type: "exported",
      requestId: request.requestId,
      blob: result.blob,
      width: result.width,
      height: result.height,
      tiled: true,
    });
  } catch (error) {
    if (!controller.signal.aborted) postError(request.requestId, error);
  } finally {
    if (activeTasks.get(request.requestId) === controller) activeTasks.delete(request.requestId);
  }
};
const openTiledPreview = async (
  request: Extract<RenderWorkerRequest, { type: "openTiledPreview" }>,
): Promise<void> => {
  try {
    const blueprint = selectBlueprint(request.doc, request.options.blueprintPath);
    const getTierPlan = createTiledPreviewTierPlanCache(assets, blueprint, {
      altMode: request.options.altMode,
      background: request.options.background,
    });
    const { drawList } = await getTierPlan("2x");
    const tileFrame = computeTileFrame(drawList.bounds, request.options.padTiles ?? 0);
    const measurement = measureTileFrame(tileFrame, 64);
    tiledPreviewSessions.set(request.sessionId, {
      doc: request.doc,
      options: request.options,
      getTierPlan,
      tileFrame,
    });
    workerScope.postMessage({
      type: "tiledPreviewReady",
      requestId: request.requestId,
      sessionId: request.sessionId,
      measurement,
    });
  } catch (error) {
    postError(request.requestId, error);
  }
};
const renderPreviewTile = async (
  request: Extract<RenderWorkerRequest, { type: "renderPreviewTile" }>,
): Promise<void> => {
  const session = tiledPreviewSessions.get(request.sessionId);
  if (!session) {
    postError(request.requestId, new Error("The tiled preview session is no longer available"));
    return;
  }
  const controller = new AbortController();
  activeTasks.set(request.requestId, controller);
  activeTaskSessions.set(request.requestId, request.sessionId);
  try {
    const { tileFrame } = request;
    if (
      tileFrame.minX < session.tileFrame.minX ||
      tileFrame.minY < session.tileFrame.minY ||
      tileFrame.maxX > session.tileFrame.maxX ||
      tileFrame.maxY > session.tileFrame.maxY ||
      tileFrame.minX >= tileFrame.maxX ||
      tileFrame.minY >= tileFrame.maxY
    ) {
      throw new Error("Preview tile must be a non-empty region inside the full output");
    }
    const bleedTiles = 2;
    const paintRegion: TileFrame = {
      minX: Math.max(session.tileFrame.minX, tileFrame.minX - bleedTiles),
      minY: Math.max(session.tileFrame.minY, tileFrame.minY - bleedTiles),
      maxX: Math.min(session.tileFrame.maxX, tileFrame.maxX + bleedTiles),
      maxY: Math.min(session.tileFrame.maxY, tileFrame.maxY + bleedTiles),
    };
    const tier: AssetTier = request.pixelsPerTile <= 32 ? "1x" : "2x";
    const { db, drawList } = await session.getTierPlan(tier);
    if (controller.signal.aborted) return;
    const preparedDrawList = drawListForTile(drawList, db.frames, paintRegion);
    const renderer = await getRenderer(tier);
    if (controller.signal.aborted) return;
    const result = await renderPreparedViewport(renderer, session.doc, {
      ...session.options,
      pixelsPerTile: request.pixelsPerTile,
      profile: false,
      tileFrame: paintRegion,
      outputTileFrame: session.tileFrame,
      preparedDrawList,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    const sourceX = (tileFrame.minX - paintRegion.minX) * request.pixelsPerTile;
    const sourceY = (tileFrame.minY - paintRegion.minY) * request.pixelsPerTile;
    const width = (tileFrame.maxX - tileFrame.minX) * request.pixelsPerTile;
    const height = (tileFrame.maxY - tileFrame.minY) * request.pixelsPerTile;
    const cropped = new OffscreenCanvas(width, height);
    const context = cropped.getContext("2d");
    if (!context) throw new Error("Failed to acquire preview tile canvas context");
    context.imageSmoothingEnabled = false;
    context.drawImage(
      result.canvas as unknown as CanvasImageSource,
      sourceX,
      sourceY,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    const bitmap = cropped.transferToImageBitmap();
    workerScope.postMessage(
      {
        type: "previewTileRendered",
        requestId: request.requestId,
        sessionId: request.sessionId,
        bitmap,
        tileFrame,
        pixelsPerTile: request.pixelsPerTile,
        width,
        height,
      },
      [bitmap],
    );
  } catch (error) {
    if (!controller.signal.aborted) postError(request.requestId, error);
  } finally {
    if (activeTasks.get(request.requestId) === controller) activeTasks.delete(request.requestId);
    activeTaskSessions.delete(request.requestId);
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
    case "exportFullPng":
      void exportFullPng(request);
      break;
    case "openTiledPreview":
      void openTiledPreview(request);
      break;
    case "renderPreviewTile":
      void renderPreviewTile(request);
      break;
    case "closeTiledPreview":
      tiledPreviewSessions.delete(request.sessionId);
      for (const [requestId, sessionId] of activeTaskSessions) {
        if (sessionId === request.sessionId) activeTasks.get(requestId)?.abort();
      }
      break;
    case "cancelTask":
      activeTasks.get(request.requestId)?.abort();
      activeTasks.delete(request.requestId);
      activeTaskSessions.delete(request.requestId);
      break;
  }
};
// Signal only after the module has initialized its asset store and message handler.
// The main thread must receive this before transferring ownership of a canvas.
workerScope.postMessage({ type: "ready" });
