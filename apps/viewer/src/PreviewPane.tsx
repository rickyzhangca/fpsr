import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  cdnAssets,
  createRenderer,
  nowMs,
  stripRichText,
  type AssetEvent,
  type Blueprint,
  type BlueprintDocument,
  type DecodeStats,
  type Renderer,
  type RenderResult,
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

const ASSETS_BASE = "/assets/2.1.9";
const NORMAL_PIXELS_PER_TILE = 32;
const HD_PIXELS_PER_TILE = 64;
const ASSETS_HINT = "Assets not found — run: pnpm -F @fpsr/pipeline run pipeline all";

function isAssetsError(message: string): boolean {
  return (
    message.includes("Failed to fetch") ||
    message.includes("404") ||
    message.includes("Not found") ||
    message.includes("ENOENT")
  );
}

function resultPixelsPerTile(result: RenderResult): number {
  const tilesX = result.tileFrame.maxX - result.tileFrame.minX;
  return tilesX > 0 ? result.width / tilesX : 32;
}

function paintDisplay(canvas: HTMLCanvasElement, result: RenderResult): void {
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(result.canvas as CanvasImageSource, 0, 0, result.width, result.height);
}

function formatTileSize(result: RenderResult | null): string {
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
}: {
  doc: BlueprintDocument | null;
  blueprint: Blueprint | null;
  blueprintPath: number[] | null;
  decodeStats?: DecodeStats | null;
  onTileSizeChange?: (tileSize: string) => void;
  onPerfReport?: (report: PerfReport | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererPromiseRef = useRef<Promise<Renderer> | null>(null);
  const renderGenRef = useRef(0);
  const assetDetailBufRef = useRef<AssetEvent[]>([]);
  const sessionBytesRef = useRef(0);

  const [hd, setHd] = useState(true);
  const pixelsPerTile = hd ? HD_PIXELS_PER_TILE : NORMAL_PIXELS_PER_TILE;
  const [altMode, setAltMode] = useState(true);
  const [showCoords, setShowCoords] = useState(false);
  const [showCheckerboard, setShowCheckerboard] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsMissing, setAssetsMissing] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [lastResult, setLastResult] = useState<RenderResult | null>(null);
  const [_hoverTile, setHoverTile] = useState<{
    cellX: number;
    cellY: number;
    tx: number;
    ty: number;
  } | null>(null);

  const getRenderer = useCallback((): Promise<Renderer> => {
    if (!rendererPromiseRef.current) {
      rendererPromiseRef.current = createRenderer({
        assets: cdnAssets(ASSETS_BASE, {
          onAssetEvent: (event) => {
            if (!event.cached) {
              assetDetailBufRef.current.push(event);
              if (event.bytes != null) {
                sessionBytesRef.current += event.bytes;
              }
            }
          },
        }),
      });
    }
    return rendererPromiseRef.current;
  }, []);

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
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      return;
    }

    const gen = ++renderGenRef.current;
    setLoading(true);
    setError(null);
    setAssetsMissing(false);
    if (!showCoords) setHoverTile(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const renderer = await getRenderer();
          if (gen !== renderGenRef.current) return;

          // Snapshot buffer index so we can collect events for this render only.
          const detailStart = assetDetailBufRef.current.length;
          const wallStart = nowMs();

          const result = await renderer.render(doc, {
            blueprintPath: blueprintPath ?? undefined,
            pixelsPerTile,
            padTiles: 1,
            altMode,
            background: null,
            showCheckerboard,
            showCoordinates: showCoords,
            profile: true,
          });
          if (gen !== renderGenRef.current) return;

          let blitMs = 0;
          const display = canvasRef.current;
          if (display) {
            const tBlit = nowMs();
            paintDisplay(display, result);
            blitMs = nowMs() - tBlit;
          }

          const wallMs = nowMs() - wallStart;
          const assetDetails = assetDetailBufRef.current.slice(detailStart);
          const profile = result.profile;
          if (profile) {
            const report: PerfReport = {
              at: Date.now(),
              cold: profile.cold,
              blitMs,
              wallMs,
              profile,
              decode: decodeStats ?? undefined,
              blueprint: {
                entityCount: blueprint.entities?.length ?? 0,
                tileCount: blueprint.tiles?.length ?? 0,
                wireCount: blueprint.wires?.length ?? 0,
                version: formatGameVersion(blueprint.version ?? 0),
                topEntities: countEntitiesByName(blueprint.entities).slice(0, 5),
              },
              assetDetails,
              sessionBytes: sessionBytesRef.current,
            };
            onPerfReport?.(report);
          }

          setDimensions({ width: result.width, height: result.height });
          setLastResult(result);
        } catch (e) {
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
          }
        }
      })();
    }, 150);

    return () => {
      window.clearTimeout(timer);
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
    getRenderer,
    onTileSizeChange,
    onPerfReport,
  ]);

  // Re-paint if the canvas mounts after the render promise resolves (fit/layout timing).
  useEffect(() => {
    if (!lastResult) return;
    const canvas = canvasRef.current;
    if (canvas) paintDisplay(canvas, lastResult);
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
