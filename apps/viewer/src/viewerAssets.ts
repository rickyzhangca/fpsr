import { cdnAssets, createRenderer, type AssetEvent, type Renderer } from "fpsr";

export const ASSETS_BASE = "/assets/2.1.9";

const eventHistory: AssetEvent[] = [];
let sessionBlobBytes = 0;

export const viewerAssets = cdnAssets(ASSETS_BASE, {
  maxConcurrentDecodes: 2,
  onAssetEvent: (event) => {
    eventHistory.push(event);
    if (!event.cached && event.bytes != null) sessionBlobBytes += event.bytes;
  },
});

let rendererPromise: Promise<Renderer> | undefined;

/** One renderer and one decoded-atlas cache for every viewer surface. */
export function getViewerRenderer(): Promise<Renderer> {
  if (!rendererPromise) {
    rendererPromise = createRenderer({ assets: viewerAssets }).catch((error) => {
      rendererPromise = undefined;
      throw error;
    });
  }
  return rendererPromise;
}

export function getAssetEventCursor(): number {
  return eventHistory.length;
}

export function getAssetEventsSince(cursor: number): AssetEvent[] {
  return eventHistory.slice(cursor);
}

export function getSessionBlobBytes(): number {
  return sessionBlobBytes;
}
