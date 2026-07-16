import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  stripRichText,
  type Blueprint,
  type BlueprintDocument,
  type DecodeStats,
  type RenderMeasurement,
} from "fpsr";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { countEntitiesByName, formatGameVersion } from "./blueprint-meta";
import type { PerfReport } from "./perf-report";
import { PreviewCanvasFrame } from "./preview-canvas-frame";
import {
  clearPreview,
  measurePreview,
  renderPreview,
  type PreviewRenderProgress,
  type PreviewRenderResult,
} from "./preview-renderer";

const FULL_PIXELS_PER_TILE = 64;
const MAX_OUTPUT_SIZE = { width: 4096, height: 4096 } as const;
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

function formatSurfaceMemory(width: number, height: number): string {
  const bytes = width * height * 4;
  return bytes < 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(0)} MB`
    : `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
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

  const [limitTo4k, setLimitTo4k] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("webp");
  const [altMode, setAltMode] = useState(true);
  const [showCoords, setShowCoords] = useState(false);
  const [showCheckerboard, setShowCheckerboard] = useState(true);
  const [preflighting, setPreflighting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsMissing, setAssetsMissing] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [lastResult, setLastResult] = useState<PreviewRenderResult | null>(null);
  const [fullResWarning, setFullResWarning] = useState<{
    blueprint: Blueprint;
    measurement: RenderMeasurement;
  } | null>(null);
  const [fullResApproval, setFullResApproval] = useState<{
    blueprint: Blueprint;
    width: number;
    height: number;
  } | null>(null);
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
  const controlsDisabled = preflighting || loading || exportPreparing;
  const downloadPendingLabel =
    !lastResult || preflighting || loading ? "Rendering" : exportPreparing ? "Encoding" : null;

  useEffect(() => {
    if (!doc || !blueprint) {
      setDimensions(null);
      setLastResult(null);
      setPreflighting(false);
      setFullResWarning(null);
      setFullResApproval(null);
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
    setError(null);
    setAssetsMissing(false);
    if (!showCoords) setHoverTile(null);

    let timer: number | undefined;
    const renderOptions = {
      blueprintPath: blueprintPath ?? undefined,
      pixelsPerTile: FULL_PIXELS_PER_TILE,
      padTiles: 1,
      altMode,
      background: null,
      showCheckerboard,
      showCoordinates: showCoords,
      profile: true,
    } as const;

    const startRender = () => {
      setPreflighting(false);
      setFullResWarning(null);
      setLoading(true);
      onRenderProgress?.({ value: 1, label: "Queued" });
      timer = window.setTimeout(() => {
        void (async () => {
          let completed = false;
          try {
            const display = canvasRef.current;
            if (!display) return;
            const result = await renderPreview(display, doc, {
              ...renderOptions,
              maxOutputSize: limitTo4k ? MAX_OUTPUT_SIZE : undefined,
              signal: controller.signal,
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
    };

    if (limitTo4k) {
      startRender();
    } else {
      setLoading(false);
      setPreflighting(true);
      onRenderProgress?.(null);
      void measurePreview(doc, renderOptions).then(
        (measurement) => {
          if (gen !== renderGenRef.current) return;
          setPreflighting(false);
          const oversized =
            measurement.requestedWidth > MAX_OUTPUT_SIZE.width ||
            measurement.requestedHeight > MAX_OUTPUT_SIZE.height;
          const approved =
            fullResApproval?.blueprint === blueprint &&
            fullResApproval.width === measurement.requestedWidth &&
            fullResApproval.height === measurement.requestedHeight;
          if (oversized && !approved) {
            setFullResWarning({ blueprint, measurement });
            return;
          }
          startRender();
        },
        (reason: unknown) => {
          if (gen !== renderGenRef.current) return;
          setPreflighting(false);
          const message = reason instanceof Error ? reason.message : "Size check failed";
          setError(message);
          setFullResWarning(null);
        },
      );
    }

    return () => {
      if (timer != null) window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    doc,
    blueprint,
    blueprintPath,
    limitTo4k,
    altMode,
    showCoords,
    showCheckerboard,
    decodeStats,
    onTileSizeChange,
    onPerfReport,
    onRenderProgress,
    fullResApproval,
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
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            id="limit-to-4k"
            checked={limitTo4k}
            disabled={controlsDisabled}
            onCheckedChange={(checked) => {
              setFullResApproval(null);
              setFullResWarning(null);
              setLimitTo4k(checked);
            }}
          />
          <Label htmlFor="limit-to-4k" className="gap-1.5">
            Limit to 4K
            <span className="text-muted-foreground">
              {dimensions && `${dimensions.width}×${dimensions.height}px`}
            </span>
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="export-format"
            aria-label="Use WebP image format"
            size="sm"
            checked={exportFormat === "webp"}
            disabled={controlsDisabled}
            onCheckedChange={(checked) => setExportFormat(checked ? "webp" : "png")}
          />
          <Label htmlFor="export-format">WebP</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            id="alt-mode"
            checked={altMode}
            disabled={controlsDisabled}
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
            disabled={controlsDisabled}
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
            disabled={controlsDisabled}
            onCheckedChange={(checked) => {
              setLoading(true);
              setShowCheckerboard(checked);
            }}
          />
          <Label htmlFor="checkerboard">Checkerboard</Label>
        </div>
      </div>

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

      <PreviewCanvasFrame
        width={dimensions?.width}
        height={dimensions?.height}
        overlay={
          fullResWarning && (
            <Alert className="max-w-lg has-data-[slot=alert-action]:pr-2.5">
              <AlertTitle>Large full-resolution render</AlertTitle>
              <AlertDescription>
                This blueprint is expected to produce a{" "}
                {fullResWarning.measurement.requestedWidth.toLocaleString()}×
                {fullResWarning.measurement.requestedHeight.toLocaleString()} image (
                {(
                  (fullResWarning.measurement.requestedWidth *
                    fullResWarning.measurement.requestedHeight) /
                  1_000_000
                ).toFixed(1)}{" "}
                MP). One RGBA surface alone is about{" "}
                {formatSurfaceMemory(
                  fullResWarning.measurement.requestedWidth,
                  fullResWarning.measurement.requestedHeight,
                )}
                ; painting, shadows, and encoding can require more.
              </AlertDescription>
              <AlertAction className="static mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setFullResWarning(null);
                    setLoading(true);
                    setLimitTo4k(true);
                  }}
                >
                  Limit to 4K
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const { measurement } = fullResWarning;
                    setFullResApproval({
                      blueprint: fullResWarning.blueprint,
                      width: measurement.requestedWidth,
                      height: measurement.requestedHeight,
                    });
                  }}
                >
                  Proceed with full res
                </Button>
              </AlertAction>
            </Alert>
          )
        }
        actions={
          !fullResWarning && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={handleDownload}
                disabled={!exportBlob || controlsDisabled}
                aria-busy={downloadPendingLabel !== null}
                title={currentExport?.error}
              >
                {downloadPendingLabel && <Spinner data-icon="inline-start" />}
                {downloadPendingLabel ??
                  (exportBlob ? `Download ${formatExportSize(exportBlob.size)}` : "Unavailable")}
              </Button>
              <Button
                onClick={() => void handleCopy()}
                disabled={!exportBlob || controlsDisabled}
                title={currentExport?.error}
              >
                Copy {exportLabel}
              </Button>
            </div>
          )
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
  );
}
