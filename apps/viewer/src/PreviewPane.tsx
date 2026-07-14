import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  nowMs,
  stripRichText,
  type Blueprint,
  type BlueprintDocument,
  type DecodeStats,
} from "fpsr";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { countEntitiesByName, formatGameVersion } from "./blueprintMeta";
import type { PerfReport } from "./perfReport";
import { PreviewCanvasFrame } from "./PreviewCanvasFrame";
import {
  clearPreview,
  renderPreview,
  type PreviewRenderProgress,
  type PreviewRenderResult,
} from "./previewRenderer";

const NORMAL_PIXELS_PER_TILE = 32;
const HD_PIXELS_PER_TILE = 64;
const ASSETS_HINT = "Assets not found — run: pnpm assets:build";

function isAssetsError(message: string): boolean {
  return (
    message.includes("Failed to fetch") ||
    message.includes("404") ||
    message.includes("Not found") ||
    message.includes("ENOENT")
  );
}

function resultPixelsPerTile(result: PreviewRenderResult): number {
  const tilesX = result.tileFrame.maxX - result.tileFrame.minX;
  return tilesX > 0 ? result.width / tilesX : 32;
}

function paintDisplayFallback(canvas: HTMLCanvasElement, result: PreviewRenderResult): void {
  if (!result.canvas || result.canvas === canvas) return;
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(result.canvas as CanvasImageSource, 0, 0, result.width, result.height);
}

function formatTileSize(result: PreviewRenderResult | null): string {
  if (!result) return "—";
  const { tileFrame } = result;
  return `${tileFrame.maxX - tileFrame.minX}×${tileFrame.maxY - tileFrame.minY} tiles`;
}

export function PreviewPane({
  doc,
  blueprint,
  blueprintPath,
  decodeStats,
  onTileSizeChange,
  onPerfReport,
  onRenderProgress,
}: {
  doc: BlueprintDocument | null;
  blueprint: Blueprint | null;
  blueprintPath: number[] | null;
  decodeStats?: DecodeStats | null;
  onTileSizeChange?: (tileSize: string) => void;
  onPerfReport?: (report: PerfReport | null) => void;
  onRenderProgress?: (progress: PreviewRenderProgress | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderGenRef = useRef(0);

  const [hd, setHd] = useState(true);
  const pixelsPerTile = hd ? HD_PIXELS_PER_TILE : NORMAL_PIXELS_PER_TILE;
  const [altMode, setAltMode] = useState(true);
  const [showCoords, setShowCoords] = useState(false);
  const [showCheckerboard, setShowCheckerboard] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsMissing, setAssetsMissing] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [lastResult, setLastResult] = useState<PreviewRenderResult | null>(null);
  const [_hoverTile, setHoverTile] = useState<{
    cellX: number;
    cellY: number;
    tx: number;
    ty: number;
  } | null>(null);

  useEffect(() => {
    onTileSizeChange?.(formatTileSize(lastResult));
  }, [lastResult, onTileSizeChange]);

  useEffect(() => {
    if (!doc || !blueprint) {
      setDimensions(null);
      setLastResult(null);
      setError(null);
      setAssetsMissing(false);
      setHoverTile(null);
      onTileSizeChange?.("—");
      onPerfReport?.(null);
      onRenderProgress?.(null);
      const canvas = canvasRef.current;
      if (canvas) {
        clearPreview(canvas);
      }
      return;
    }

    const gen = ++renderGenRef.current;
    const controller = new AbortController();
    setLoading(true);
    onRenderProgress?.({ value: 1, label: "Queued" });
    setError(null);
    setAssetsMissing(false);
    if (!showCoords) setHoverTile(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        let completed = false;
        try {
          const display = canvasRef.current;
          if (!display) return;
          const result = await renderPreview(display, doc, {
            blueprintPath: blueprintPath ?? undefined,
            pixelsPerTile,
            padTiles: 1,
            altMode,
            background: null,
            showCheckerboard,
            showCoordinates: showCoords,
            signal: controller.signal,
            profile: true,
            onProgress: onRenderProgress,
          });
          if (gen !== renderGenRef.current) return;

          let blitMs = 0;
          if (display && result.canvas !== display) {
            const tBlit = nowMs();
            paintDisplayFallback(display, result);
            blitMs = nowMs() - tBlit;
          }

          const profile = result.profile;
          if (profile) {
            const report: PerfReport = {
              at: Date.now(),
              cold: profile.cold,
              backend: result.backend,
              blitMs,
              wallMs: result.wallMs + blitMs,
              profile,
              decode: decodeStats ?? undefined,
              blueprint: {
                entityCount: blueprint.entities?.length ?? 0,
                tileCount: blueprint.tiles?.length ?? 0,
                wireCount: blueprint.wires?.length ?? 0,
                version: formatGameVersion(blueprint.version ?? 0),
                topEntities: countEntitiesByName(blueprint.entities).slice(0, 5),
              },
              assetDetails: result.assetDetails,
              sessionBytes: result.sessionBytes,
            };
            onPerfReport?.(report);
          }

          setDimensions({ width: result.width, height: result.height });
          setLastResult(result);
          completed = true;
          onRenderProgress?.({
            value: 100,
            label: "Complete",
            durationMs: result.wallMs + blitMs,
          });
        } catch (e) {
          if (controller.signal.aborted) return;
          if (gen !== renderGenRef.current) return;
          const message = e instanceof Error ? e.message : "Render failed";
          setAssetsMissing(isAssetsError(message));
          setError(message);
          setDimensions(null);
          setLastResult(null);
          setHoverTile(null);
          onPerfReport?.(null);
        } finally {
          if (gen === renderGenRef.current) {
            setLoading(false);
            if (!completed) onRenderProgress?.(null);
          }
        }
      })();
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    doc,
    blueprint,
    blueprintPath,
    pixelsPerTile,
    altMode,
    showCoords,
    showCheckerboard,
    decodeStats,
    onTileSizeChange,
    onPerfReport,
    onRenderProgress,
  ]);

  // Re-paint if the canvas mounts after the render promise resolves (fit/layout timing).
  useEffect(() => {
    if (!lastResult) return;
    const canvas = canvasRef.current;
    if (canvas) paintDisplayFallback(canvas, lastResult);
  }, [lastResult]);

  const handleDownload = useCallback(async () => {
    if (!lastResult) return;
    const filename = `${stripRichText(blueprint?.label).replace(/[^\w.-]+/g, "_") || "blueprint"}.png`;
    try {
      const blob = await lastResult.toPngBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("PNG downloaded", { description: filename });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Download failed";
      toast.error(message);
    }
  }, [lastResult, blueprint?.label]);

  const handleCopyPng = useCallback(async () => {
    if (!lastResult) return;
    try {
      const blob = await lastResult.toPngBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("PNG copied to clipboard");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Copy failed";
      toast.error(message);
    }
  }, [lastResult]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!showCoords || !lastResult) {
        setHoverTile(null);
        return;
      }
      const canvas = event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setHoverTile(null);
        return;
      }
      const scaleX = lastResult.width / rect.width;
      const scaleY = lastResult.height / rect.height;
      const px = (event.clientX - rect.left) * scaleX;
      const py = (event.clientY - rect.top) * scaleY;
      const ppt = resultPixelsPerTile(lastResult);
      const { minX, minY, maxX, maxY } = lastResult.tileFrame;
      const tx = minX + px / ppt;
      const ty = minY + py / ppt;
      if (tx < minX || ty < minY || tx >= maxX || ty >= maxY) {
        setHoverTile(null);
        return;
      }
      setHoverTile({
        cellX: Math.floor(tx),
        cellY: Math.floor(ty),
        tx,
        ty,
      });
    },
    [showCoords, lastResult],
  );

  const handlePointerLeave = useCallback(() => {
    setHoverTile(null);
  }, []);

  if (!doc || !blueprint) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {assetsMissing && (
        <Alert className="shrink-0 mx-4">
          <AlertTitle>Assets missing</AlertTitle>
          <AlertDescription className="font-mono text-xs">{ASSETS_HINT}</AlertDescription>
        </Alert>
      )}
      {error && !assetsMissing && (
        <Alert className="shrink-0 mx-4" variant="destructive">
          <AlertTitle>Render error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-5 p-4">
          <div className="flex items-center gap-2">
            <Switch size="sm" id="hd" checked={hd} onCheckedChange={setHd} />
            <Label htmlFor="hd">
              HD
              <span className="text-muted-foreground">
                {dimensions && (
                  <>
                    {dimensions.width}×{dimensions.height}px
                  </>
                )}
              </span>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch size="sm" id="alt-mode" checked={altMode} onCheckedChange={setAltMode} />
            <Label htmlFor="alt-mode">Alt mode</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch size="sm" id="coords" checked={showCoords} onCheckedChange={setShowCoords} />
            <Label htmlFor="coords">Coords</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="checkerboard"
              checked={showCheckerboard}
              onCheckedChange={setShowCheckerboard}
            />
            <Label htmlFor="checkerboard">Checkerboard</Label>
          </div>
        </div>

        <PreviewCanvasFrame
          width={dimensions?.width}
          height={dimensions?.height}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => void handleDownload()}
                disabled={!lastResult || loading}
              >
                Download
              </Button>
              <Button onClick={() => void handleCopyPng()} disabled={!lastResult || loading}>
                Copy PNG
              </Button>
            </div>
          }
        >
          <canvas
            ref={canvasRef}
            className="size-full [image-rendering:pixelated]"
            draggable={false}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          />
        </PreviewCanvasFrame>
      </div>
    </div>
  );
}
