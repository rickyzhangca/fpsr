import type { AssetEvent, BlueprintDocument, RenderOptions, RenderProfile, TileFrame } from "fpsr";

export type WorkerRenderOptions = Omit<RenderOptions, "canvas" | "signal">;

export type RenderWorkerRequest =
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
    };

export type RenderWorkerResponse =
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
