import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { stripRichText, type Blueprint, type BlueprintDocument, type DecodeStats } from "fpsr";
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
const WEBP_QUALITY = 0.9;
const ASSETS_HINT = "Assets not found — run: pnpm assets:build";

type ExportFormat = "webp" | "png";

const EXPORT_OPTIONS = {
  webp: { type: "image/webp", quality: WEBP_QUALITY },
  png: { type: "image/png" },
} as const;

function exportFormatLabel(format: ExportFormat): "WebP" | "PNG" {
  return format === "webp" ? "WebP" : "PNG";
}

function formatExportSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const exportPromisesRef = useRef<{
    result: PreviewRenderResult;
    promises: Partial<Record<ExportFormat, Promise<Blob>>>;
  } | null>(null);

  const [hd, setHd] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("webp");
  const pixelsPerTile = hd ? HD_PIXELS_PER_TILE : NORMAL_PIXELS_PER_TILE;
  const [altMode, setAltMode] = useState(true);
  const [showCoords, setShowCoords] = useState(false);
  const [showCheckerboard, setShowCheckerboard] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsMissing, setAssetsMissing] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [lastResult, setLastResult] = useState<PreviewRenderResult | null>(null);
  const [preparedExports, setPreparedExports] = useState<{
    result: PreviewRenderResult;
    formats: Partial<Record<ExportFormat, { blob?: Blob; error?: string }>>;
  } | null>(null);
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
    if (!lastResult) {
      exportPromisesRef.current = null;
      setPreparedExports(null);
      return;
    }

    let cache = exportPromisesRef.current;
    if (cache?.result !== lastResult) {
      cache = { result: lastResult, promises: {} };
      exportPromisesRef.current = cache;
    }

    let promise = cache.promises[exportFormat];
    if (!promise) {
      promise = lastResult.toImageBlob(EXPORT_OPTIONS[exportFormat]);
      cache.promises[exportFormat] = promise;
    }

    let stale = false;
    setPreparedExports((current) =>
      current?.result === lastResult ? current : { result: lastResult, formats: {} },
    );
    void promise.then(
      (blob) => {
        if (stale) return;
        setPreparedExports((current) => ({
          result: lastResult,
          formats: {
            ...(current?.result === lastResult ? current.formats : {}),
            [exportFormat]: { blob },
          },
        }));
      },
      (error: unknown) => {
        if (stale) return;
        const message = error instanceof Error ? error.message : "Image encoding failed";
        setPreparedExports((current) => ({
          result: lastResult,
          formats: {
            ...(current?.result === lastResult ? current.formats : {}),
            [exportFormat]: { error: message },
          },
        }));
        if (exportPromisesRef.current?.result === lastResult) {
          delete exportPromisesRef.current.promises[exportFormat];
        }
      },
    );

    return () => {
      stale = true;
    };
  }, [lastResult, exportFormat]);

  const currentExport =
    preparedExports?.result === lastResult ? preparedExports.formats[exportFormat] : undefined;
  const exportBlob = currentExport?.blob;
  const exportLabel = exportFormatLabel(exportFormat);
  const exportPreparing = Boolean(lastResult && !currentExport);
  const downloadPendingLabel =
    !lastResult || loading ? "Rendering" : exportPreparing ? "Encoding" : null;

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

          const profile = result.profile;
          if (profile) {
            const report: PerfReport = {
              at: Date.now(),
              cold: profile.cold,
              wallMs: result.wallMs,
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
            durationMs: result.wallMs,
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

  const handleDownload = useCallback(() => {
    if (!exportBlob) return;
    const filename = `${stripRichText(blueprint?.label).replace(/[^\w.-]+/g, "_") || "blueprint"}.${exportFormat}`;
    try {
      const url = URL.createObjectURL(exportBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`${exportLabel} downloaded`, { description: filename });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Download failed";
      toast.error(message);
    }
  }, [exportBlob, blueprint?.label, exportFormat, exportLabel]);

  const handleCopy = useCallback(async () => {
    if (!exportBlob) return;
    try {
      const mime = EXPORT_OPTIONS[exportFormat].type;
      if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports(mime)) {
        throw new Error(`${exportLabel} images are not supported by this browser's clipboard`);
      }
      await navigator.clipboard.write([new ClipboardItem({ [mime]: exportBlob })]);
      toast.success(`${exportLabel} copied to clipboard`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Copy failed";
      toast.error(message);
    }
  }, [exportBlob, exportFormat, exportLabel]);

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
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-1 pb-3">
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="hd"
              checked={hd}
              disabled={loading}
              onCheckedChange={(checked) => {
                setLoading(true);
                setHd(checked);
              }}
            />
            <Label htmlFor="hd">
              HD assets
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
            <Switch
              id="export-format"
              aria-label="Use WebP image format"
              size="sm"
              checked={exportFormat === "webp"}
              disabled={loading || exportPreparing}
              onCheckedChange={(checked) => setExportFormat(checked ? "webp" : "png")}
            />
            <Label htmlFor="export-format">WebP</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="alt-mode"
              checked={altMode}
              disabled={loading}
              onCheckedChange={(checked) => {
                setLoading(true);
                setAltMode(checked);
              }}
            />
            <Label htmlFor="alt-mode">Alt mode</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="coords"
              checked={showCoords}
              disabled={loading}
              onCheckedChange={(checked) => {
                setLoading(true);
                setShowCoords(checked);
              }}
            />
            <Label htmlFor="coords">Coords</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="checkerboard"
              checked={showCheckerboard}
              disabled={loading}
              onCheckedChange={(checked) => {
                setLoading(true);
                setShowCheckerboard(checked);
              }}
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
                onClick={handleDownload}
                disabled={!exportBlob || loading}
                aria-busy={downloadPendingLabel !== null}
                title={currentExport?.error}
              >
                {downloadPendingLabel && <Spinner data-icon="inline-start" />}
                {downloadPendingLabel ??
                  (exportBlob ? `Download ${formatExportSize(exportBlob.size)}` : "Unavailable")}
              </Button>
              <Button
                onClick={() => void handleCopy()}
                disabled={!exportBlob || loading}
                title={currentExport?.error}
              >
                Copy {exportLabel}
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
