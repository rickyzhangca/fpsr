import type {
  AssetEvent,
  BlueprintDocument,
  RenderImageOptions,
  RenderOptions,
  RenderMeasurement,
  RenderProfile,
  RenderProgressEvent,
  TileFrame,
} from "fpsr";

export type WorkerRenderOptions = Omit<RenderOptions, "canvas" | "signal" | "onProgress">;

export interface PreviewRenderProgress {
  value: number;
  label: string;
  /** Final render wall time; present only after the render completes. */
  durationMs?: number;
}

export function toPreviewRenderProgress(event: RenderProgressEvent): PreviewRenderProgress {
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
    case "complete":
      return { value: 100, label: "Complete" };
  }
}

export type RenderWorkerRequest =
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
    };

export type RenderWorkerResponse =
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
      surfaceId: string;
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
    }
  | {
      type: "error";
      requestId: number;
      name: string;
      message: string;
    };
