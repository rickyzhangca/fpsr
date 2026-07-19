import type { PlanDiagnostics } from "@/process/plan-diagnostics";
import type {
  AssetEvent,
  Blueprint,
  BlueprintDocument,
  DrawList,
  RenderImageOptions,
  RenderMeasurement,
  RenderOptions,
  RenderProfile,
  RenderProgressEvent,
  TileFrame,
} from "@rickyzhangca/fpsr";
import type { PlanOptions } from "@rickyzhangca/fpsr/planner";
import type { PreviewTilePixelsPerTile } from "./preview-tiles";
export type WorkerRenderOptions = Omit<RenderOptions, "canvas" | "signal" | "onProgress">;
export type WorkerTiledPreviewOptions = Omit<
  WorkerRenderOptions,
  "maxOutputSize" | "pixelsPerTile" | "profile"
>;
export type WorkerPlanOptions = Pick<PlanOptions, "altMode" | "beltEndings">;
export interface PreviewRenderProgress {
  value: number;
  label: string;
  /** Final render wall time; present only after the render completes. */
  durationMs?: number;
}
export const toPreviewRenderProgress = (event: RenderProgressEvent): PreviewRenderProgress => {
  switch (event.stage) {
    case "planning":
      return { value: 12, label: "Planning" };
    case "loading-assets": {
      const ratio = event.total === 0 ? 1 : event.completed / event.total;
      return {
        value: 15 + Math.round(65 * ratio),
        label:
          event.total === 0 ? "Assets ready" : `Loading assets ${event.completed}/${event.total}`,
      };
    }
    case "baking-icons":
      return { value: 84, label: "Preparing icons" };
    case "painting":
      return { value: 92, label: "Painting" };
    case "painting-tiles": {
      const ratio = event.total === 0 ? 1 : event.completed / event.total;
      return {
        value: 10 + Math.round(82 * ratio),
        label: `Rendering tiles ${event.completed}/${event.total}`,
      };
    }
    case "encoding":
      return { value: 96, label: "Encoding PNG" };
    case "complete":
      return { value: 100, label: "Complete" };
  }
};
export type RenderWorkerRequest =
  | {
      type: "plan";
      requestId: number;
      blueprint: Blueprint;
      options: WorkerPlanOptions;
    }
  | {
      type: "measure";
      requestId: number;
      doc: BlueprintDocument;
      options: WorkerRenderOptions;
    }
  | {
      type: "attach";
      surfaceId: string;
      canvas: OffscreenCanvas;
    }
  | {
      type: "render";
      requestId: number;
      surfaceId: string;
      doc: BlueprintDocument;
      options: WorkerRenderOptions;
    }
  | {
      type: "cancel";
      requestId: number;
      surfaceId: string;
    }
  | {
      type: "clear";
      surfaceId: string;
    }
  | {
      type: "export";
      requestId: number;
      renderId: number;
      surfaceId: string;
      options: RenderImageOptions;
    }
  | {
      type: "exportFullPng";
      requestId: number;
      doc: BlueprintDocument;
      options: WorkerRenderOptions;
    }
  | {
      type: "openTiledPreview";
      requestId: number;
      sessionId: string;
      doc: BlueprintDocument;
      options: WorkerTiledPreviewOptions;
    }
  | {
      type: "renderPreviewTile";
      requestId: number;
      sessionId: string;
      tileFrame: TileFrame;
      pixelsPerTile: PreviewTilePixelsPerTile;
    }
  | {
      type: "closeTiledPreview";
      sessionId: string;
    }
  | {
      type: "cancelTask";
      requestId: number;
    }
  | {
      type: "setAssetOrigin";
      requestId: number;
      origin: "local" | "cdn";
    };
export type RenderWorkerResponse =
  | {
      type: "planned";
      requestId: number;
      drawList: DrawList;
      diagnostics: PlanDiagnostics;
    }
  | {
      type: "measured";
      requestId: number;
      measurement: RenderMeasurement;
    }
  | {
      type: "ready";
    }
  | {
      type: "progress";
      requestId: number;
      surfaceId?: string;
      progress: PreviewRenderProgress;
    }
  | {
      type: "rendered";
      requestId: number;
      surfaceId: string;
      width: number;
      height: number;
      tileFrame: TileFrame;
      profile?: RenderProfile;
      assetDetails: AssetEvent[];
      sessionBytes: number;
      wallMs: number;
    }
  | {
      type: "exported";
      requestId: number;
      blob: Blob;
      width?: number;
      height?: number;
      tiled?: boolean;
    }
  | {
      type: "tiledPreviewReady";
      requestId: number;
      sessionId: string;
      measurement: RenderMeasurement;
    }
  | {
      type: "previewTileRendered";
      requestId: number;
      sessionId: string;
      bitmap: ImageBitmap;
      tileFrame: TileFrame;
      pixelsPerTile: PreviewTilePixelsPerTile;
      width: number;
      height: number;
    }
  | {
      type: "error";
      requestId: number;
      name: string;
      message: string;
    }
  | {
      type: "assetOriginSet";
      requestId: number;
      origin: "local" | "cdn";
      baseUrl: string;
    };
