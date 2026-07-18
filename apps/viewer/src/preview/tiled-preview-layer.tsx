import type { BlueprintDocument, RenderMeasurement } from "fpsr";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  openTiledPreview,
  type PreviewTileResult,
  type TiledPreviewSession,
} from "./preview-renderer";
import {
  selectPreviewPixelsPerTile,
  visiblePreviewTiles,
  type PreviewTileDescriptor,
  type PreviewTilePixelsPerTile,
  type TiledPreviewViewport,
} from "./preview-tiles";
import type { WorkerTiledPreviewOptions } from "./render-worker-protocol";

const MAX_CACHED_TILES = 96;
const MAX_CONCURRENT_TILES = 4;

interface CachedPreviewTile extends PreviewTileDescriptor, PreviewTileResult {}

export interface TiledPreviewStatus {
  pixelsPerTile: PreviewTilePixelsPerTile;
  ready: number;
  total: number;
}

const closeCache = (cache: Map<string, CachedPreviewTile>): void => {
  for (const tile of cache.values()) tile.bitmap.close();
  cache.clear();
};

const evictOldTiles = (
  cache: Map<string, CachedPreviewTile>,
  protectedKeys: ReadonlySet<string>,
): void => {
  while (cache.size > MAX_CACHED_TILES) {
    let victim: string | undefined;
    for (const key of cache.keys()) {
      if (!protectedKeys.has(key)) {
        victim = key;
        break;
      }
    }
    victim ??= cache.keys().next().value;
    if (victim == null) return;
    cache.get(victim)?.bitmap.close();
    cache.delete(victim);
  }
};

export const TiledPreviewLayer = ({
  doc,
  options,
  measurement,
  viewport,
  onStatusChange,
  onError,
}: {
  doc: BlueprintDocument;
  options: WorkerTiledPreviewOptions;
  measurement: RenderMeasurement;
  viewport: TiledPreviewViewport;
  onStatusChange?: (status: TiledPreviewStatus) => void;
  onError?: (error: Error) => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef(new Map<string, CachedPreviewTile>());
  const inFlightRef = useRef(new Map<string, AbortController>());
  const sessionRef = useRef<TiledPreviewSession | null>(null);
  const [session, setSession] = useState<TiledPreviewSession | null>(null);
  const [revision, setRevision] = useState(0);
  const devicePixelRatio =
    typeof window === "undefined" ? 1 : Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const pixelsPerTile = selectPreviewPixelsPerTile(viewport.zoom, devicePixelRatio);
  const wantedTiles = useMemo(
    () => visiblePreviewTiles(measurement, viewport, pixelsPerTile),
    [measurement, viewport, pixelsPerTile],
  );

  useEffect(() => {
    let disposed = false;
    let openedSession: TiledPreviewSession | null = null;
    const cache = cacheRef.current;
    const inFlight = inFlightRef.current;
    setSession(null);
    sessionRef.current?.close();
    sessionRef.current = null;
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
    closeCache(cache);
    setRevision((value) => value + 1);
    void openTiledPreview(doc, options).then(
      (nextSession) => {
        if (disposed) {
          nextSession.close();
          return;
        }
        openedSession = nextSession;
        sessionRef.current = nextSession;
        setSession(nextSession);
      },
      (reason: unknown) => {
        if (!disposed) onError?.(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      disposed = true;
      openedSession?.close();
      if (sessionRef.current === openedSession) sessionRef.current = null;
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
      closeCache(cache);
    };
  }, [doc, options, onError]);

  useEffect(() => {
    if (!session) return;
    const inFlight = inFlightRef.current;
    const wantedKeys = new Set(wantedTiles.map((tile) => tile.key));
    const activeControllers = new Map<string, AbortController>();
    for (const [key, controller] of inFlight) {
      if (!wantedKeys.has(key)) {
        controller.abort();
        inFlight.delete(key);
      }
    }
    const queue = wantedTiles.filter(
      (tile) => !cacheRef.current.has(tile.key) && !inFlight.has(tile.key),
    );
    let cursor = 0;
    let stopped = false;
    const renderNext = async (): Promise<void> => {
      while (!stopped && cursor < queue.length) {
        const descriptor = queue[cursor++];
        if (!descriptor) return;
        const controller = new AbortController();
        activeControllers.set(descriptor.key, controller);
        inFlight.set(descriptor.key, controller);
        try {
          const result = await session.renderTile(
            descriptor.tileFrame,
            descriptor.pixelsPerTile,
            controller.signal,
          );
          if (stopped || sessionRef.current !== session) {
            result.bitmap.close();
            continue;
          }
          const previous = cacheRef.current.get(descriptor.key);
          previous?.bitmap.close();
          cacheRef.current.delete(descriptor.key);
          cacheRef.current.set(descriptor.key, { ...descriptor, ...result });
          evictOldTiles(cacheRef.current, wantedKeys);
          setRevision((value) => value + 1);
        } catch (reason) {
          if (!controller.signal.aborted && !stopped) {
            onError?.(reason instanceof Error ? reason : new Error(String(reason)));
          }
        } finally {
          activeControllers.delete(descriptor.key);
          if (inFlight.get(descriptor.key) === controller) {
            inFlight.delete(descriptor.key);
          }
        }
      }
    };
    const runners = Array.from({ length: Math.min(MAX_CONCURRENT_TILES, queue.length) }, () =>
      renderNext(),
    );
    void Promise.all(runners);
    return () => {
      stopped = true;
      for (const [key, controller] of activeControllers) {
        controller.abort();
        if (inFlight.get(key) === controller) inFlight.delete(key);
      }
    };
  }, [session, wantedTiles, onError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(1, Math.round(viewport.width * devicePixelRatio));
    const height = Math.max(1, Math.round(viewport.height * devicePixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.imageSmoothingEnabled = false;
    const cachedTiles = [...cacheRef.current.values()].sort(
      (left, right) => left.pixelsPerTile - right.pixelsPerTile,
    );
    for (const tile of cachedTiles) {
      const x =
        viewport.width / 2 +
        viewport.panX +
        (tile.fullPixelX - measurement.width / 2) * viewport.zoom;
      const y =
        viewport.height / 2 +
        viewport.panY +
        (tile.fullPixelY - measurement.height / 2) * viewport.zoom;
      const displayWidth = tile.fullPixelWidth * viewport.zoom;
      const displayHeight = tile.fullPixelHeight * viewport.zoom;
      if (
        x >= viewport.width ||
        y >= viewport.height ||
        x + displayWidth <= 0 ||
        y + displayHeight <= 0
      ) {
        continue;
      }
      context.drawImage(tile.bitmap, x, y, displayWidth, displayHeight);
    }
  }, [devicePixelRatio, measurement, revision, viewport]);

  useEffect(() => {
    const ready = wantedTiles.reduce(
      (count, tile) => count + Number(cacheRef.current.has(tile.key)),
      0,
    );
    onStatusChange?.({ pixelsPerTile, ready, total: wantedTiles.length });
  }, [onStatusChange, pixelsPerTile, revision, wantedTiles]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Full-resolution tiled preview"
      className="block size-full [image-rendering:pixelated]"
    />
  );
};
