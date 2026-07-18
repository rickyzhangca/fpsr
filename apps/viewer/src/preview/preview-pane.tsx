import { formatGameVersion } from "@/blueprint/blueprint-meta";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PerfReport } from "@/performance/perf-report";
import { viewerAssets } from "@/shell/viewer-assets";
import { previewPreferencesAtom, type PreviewBackgroundMode } from "@/shell/viewer-preferences";
import {
  countBlueprintComponents,
  type Blueprint,
  type BlueprintDocument,
  type DecodeStats,
  type RenderMeasurement,
} from "fpsr";
import { useAtom } from "jotai";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_ORBIT_PLANETS,
  STATIC_BACKGROUND_LABELS,
  TERRAIN_BACKGROUND_MODES,
  formatPlanetLabel,
  isTerrainBackgroundMode,
  orbitBackgroundOptionLabel,
  orbitSelectValue,
  parseOrbitSelectValue,
  sortOrbitPlanets,
  staticBackgroundOptionLabel,
} from "./background-controls";
import { PreviewExportControls } from "./export-controls";
import {
  EXPORT_OPTIONS,
  formatSurfaceMemory,
  formatTileSize,
  resultPixelsPerTile,
  type ExportFormat,
} from "./format";
import { PreviewCanvasFrame } from "./preview-canvas-frame";
import {
  clearPreview,
  measurePreview,
  renderPreview,
  type PreviewRenderResult,
} from "./preview-renderer";
import { ASSETS_MISSING_HINT, isMissingAssetsError } from "./render-errors";
import type { PreviewRenderProgress } from "./render-worker-protocol";

const FULL_PIXELS_PER_TILE = 64;
const MAX_OUTPUT_SIZE = { width: 4096, height: 4096 } as const;

export const PreviewPane = ({
  doc,
  blueprint,
  blueprintPath,
  decodeStats,
  onTileSizeChange,
  onPerfReport,
  onRenderProgress,
  onRenderError,
}: {
  doc: BlueprintDocument | null;
  blueprint: Blueprint | null;
  blueprintPath: number[] | null;
  decodeStats?: DecodeStats | null;
  onTileSizeChange?: (tileSize: string) => void;
  onPerfReport?: (report: PerfReport | null) => void;
  onRenderProgress?: (progress: PreviewRenderProgress | null) => void;
  onRenderError?: (error: string | null) => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderGenRef = useRef(0);
  const exportPromisesRef = useRef<{
    result: PreviewRenderResult;
    promises: Partial<Record<ExportFormat, Promise<Blob>>>;
  } | null>(null);
  const [previewPreferences, setPreviewPreferences] = useAtom(previewPreferencesAtom);
  const {
    limitTo4k,
    exportFormat,
    altMode,
    showCoords,
    showBackground,
    backgroundMode,
    orbitPlanet,
  } = previewPreferences;
  const setLimitTo4k = (value: boolean) => {
    setPreviewPreferences((previous) => ({ ...previous, limitTo4k: value }));
  };
  const setExportFormat = (value: ExportFormat) => {
    setPreviewPreferences((previous) => ({ ...previous, exportFormat: value }));
  };
  const setAltMode = (value: boolean) => {
    setPreviewPreferences((previous) => ({ ...previous, altMode: value }));
  };
  const setShowCoords = (value: boolean) => {
    setPreviewPreferences((previous) => ({ ...previous, showCoords: value }));
  };
  const setShowBackground = (value: boolean) => {
    setPreviewPreferences((previous) => ({ ...previous, showBackground: value }));
  };
  const setBackgroundSelection = (mode: PreviewBackgroundMode, planet?: string) => {
    setPreviewPreferences((previous) => ({
      ...previous,
      backgroundMode: mode,
      ...(planet != null ? { orbitPlanet: planet } : {}),
    }));
  };
  const [orbitPlanets, setOrbitPlanets] = useState<string[]>([...DEFAULT_ORBIT_PLANETS]);
  const [terrainModes, setTerrainModes] = useState<string[]>([...TERRAIN_BACKGROUND_MODES]);
  const [preflighting, setPreflighting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsMissing, setAssetsMissing] = useState(false);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
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
    formats: Partial<
      Record<
        ExportFormat,
        {
          blob?: Blob;
          error?: string;
        }
      >
    >;
  } | null>(null);
  const [_hoverTile, setHoverTile] = useState<{
    cellX: number;
    cellY: number;
    tx: number;
    ty: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void viewerAssets
      .loadRenderDb()
      .then((db) => {
        if (cancelled) return;
        const names = Object.keys(db.spaceBackground?.planets ?? {});
        setOrbitPlanets(names.length > 0 ? sortOrbitPlanets(names) : [...DEFAULT_ORBIT_PLANETS]);
        const terrainKeys = Object.keys(db.terrainBackgrounds ?? {});
        const known = TERRAIN_BACKGROUND_MODES.filter((name) => terrainKeys.includes(name));
        setTerrainModes(known.length > 0 ? [...known] : [...TERRAIN_BACKGROUND_MODES]);
      })
      .catch(() => {
        if (!cancelled) {
          setOrbitPlanets([...DEFAULT_ORBIT_PLANETS]);
          setTerrainModes([...TERRAIN_BACKGROUND_MODES]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const orbitPlanetOptions = sortOrbitPlanets(
    orbitPlanets.includes(orbitPlanet) ? orbitPlanets : [...orbitPlanets, orbitPlanet],
  );
  const terrainModeOptions = (() => {
    const modes = [...terrainModes];
    if (isTerrainBackgroundMode(backgroundMode) && !modes.includes(backgroundMode)) {
      modes.push(backgroundMode);
    }
    return modes.filter(isTerrainBackgroundMode);
  })();
  const backgroundSelectValue =
    backgroundMode === "orbit" ? orbitSelectValue(orbitPlanet) : backgroundMode;
  const backgroundSelectItems: Record<string, string> = {
    auto: STATIC_BACKGROUND_LABELS.auto,
    checkerboard: STATIC_BACKGROUND_LABELS.checkerboard,
    space: STATIC_BACKGROUND_LABELS.space,
  };
  for (const mode of terrainModeOptions) {
    backgroundSelectItems[mode] = STATIC_BACKGROUND_LABELS[mode];
  }
  for (const planet of orbitPlanetOptions) {
    backgroundSelectItems[orbitSelectValue(planet)] = `${formatPlanetLabel(planet)} orbit`;
  }
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
      onRenderError?.(null);
      const canvas = canvasRef.current;
      if (canvas) {
        clearPreview(canvas);
      }
      return;
    }
    const gen = ++renderGenRef.current;
    const controller = new AbortController();
    setError(null);
    onRenderError?.(null);
    setAssetsMissing(false);
    if (!showCoords) setHoverTile(null);
    let timer: number | undefined;
    const renderOptions = {
      blueprintPath: blueprintPath ?? undefined,
      pixelsPerTile: FULL_PIXELS_PER_TILE,
      padTiles: 1,
      altMode,
      background: null,
      showBackgroundAuto: showBackground && backgroundMode === "auto",
      showCheckerboard: showBackground && backgroundMode === "checkerboard",
      showSpace: showBackground && (backgroundMode === "space" || backgroundMode === "orbit"),
      showSpacePlanet: showBackground && backgroundMode === "orbit",
      spacePlanet: backgroundMode === "orbit" ? orbitPlanet : undefined,
      terrainBackground:
        showBackground && isTerrainBackgroundMode(backgroundMode) ? backgroundMode : undefined,
      showCoordinates: showCoords,
      profile: true,
    } as const;
    const startRender = () => {
      setPreflighting(false);
      setFullResWarning(null);
      setLoading(true);
      onRenderProgress?.({ value: 1, label: "Queued" });
      timer = window.setTimeout(() => {
        const finishRender = (completed: boolean) => {
          if (gen !== renderGenRef.current) return;
          setLoading(false);
          if (!completed) onRenderProgress?.(null);
        };
        const display = canvasRef.current;
        if (!display) {
          finishRender(false);
          return;
        }
        void renderPreview(display, doc, {
          ...renderOptions,
          maxOutputSize: limitTo4k ? MAX_OUTPUT_SIZE : undefined,
          signal: controller.signal,
          onProgress: onRenderProgress,
        })
          .then(async (result) => {
            if (gen !== renderGenRef.current) return;
            const profile = result.profile;
            if (profile) {
              const db = await viewerAssets.loadRenderDb();
              if (gen !== renderGenRef.current) return;
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
                  topComponents: countBlueprintComponents(blueprint, db).slice(0, 5),
                },
                assetDetails: result.assetDetails,
                sessionBytes: result.sessionBytes,
              };
              onPerfReport?.(report);
            }
            setDimensions({ width: result.width, height: result.height });
            setLastResult(result);
            onRenderProgress?.({
              value: 100,
              label: "Complete",
              durationMs: result.wallMs,
            });
            finishRender(true);
          })
          .catch((e: unknown) => {
            if (controller.signal.aborted) {
              finishRender(false);
              return;
            }
            if (gen !== renderGenRef.current) return;
            const message = e instanceof Error ? e.message : "Render failed";
            setAssetsMissing(isMissingAssetsError(message));
            setError(message);
            onRenderError?.(message);
            setDimensions(null);
            setLastResult(null);
            setHoverTile(null);
            onPerfReport?.(null);
            finishRender(false);
          });
      }, 150);
    };
    if (limitTo4k) {
      startRender();
    } else {
      setLoading(false);
      setPreflighting(true);
      onRenderProgress?.({ value: 3, label: "Measuring output" });
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
            onRenderProgress?.({ value: 3, label: "Awaiting approval" });
            return;
          }
          startRender();
        },
        (reason: unknown) => {
          if (gen !== renderGenRef.current) return;
          setPreflighting(false);
          const message = reason instanceof Error ? reason.message : "Size check failed";
          setError(message);
          onRenderError?.(message);
          setFullResWarning(null);
          onRenderProgress?.(null);
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
    showBackground,
    backgroundMode,
    orbitPlanet,
    decodeStats,
    onTileSizeChange,
    onPerfReport,
    onRenderProgress,
    onRenderError,
    fullResApproval,
  ]);
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
  };
  const handlePointerLeave = () => {
    setHoverTile(null);
  };
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
            id="background"
            checked={showBackground}
            disabled={controlsDisabled}
            onCheckedChange={(checked) => {
              setLoading(true);
              setShowBackground(checked);
            }}
          />
          <Label htmlFor="background">Background</Label>
          <Select
            value={backgroundSelectValue}
            onValueChange={(value) => {
              if (value == null) return;
              const selectedOrbitPlanet = parseOrbitSelectValue(value);
              if (selectedOrbitPlanet != null) {
                if (backgroundMode === "orbit" && selectedOrbitPlanet === orbitPlanet) return;
                setLoading(true);
                setBackgroundSelection("orbit", selectedOrbitPlanet);
                return;
              }
              if (
                value !== "auto" &&
                value !== "checkerboard" &&
                value !== "space" &&
                !isTerrainBackgroundMode(value)
              ) {
                return;
              }
              // Same selection still fires onValueChange; skip so we don't
              // set loading without a render effect to clear it.
              if (value === backgroundMode) return;
              setLoading(true);
              setBackgroundSelection(value);
            }}
            disabled={controlsDisabled || !showBackground}
            items={backgroundSelectItems}
          >
            <SelectTrigger
              id="background-mode"
              size="sm"
              aria-label="Background style"
              className="h-auto min-h-0 gap-1 border-transparent p-0 text-sm leading-none data-[size=sm]:h-auto [&_svg]:size-3.5 dark:bg-transparent dark:hover:bg-transparent"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value="auto">{staticBackgroundOptionLabel("auto")}</SelectItem>
                <SelectItem value="checkerboard">
                  {staticBackgroundOptionLabel("checkerboard")}
                </SelectItem>
                {terrainModeOptions.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {staticBackgroundOptionLabel(mode)}
                  </SelectItem>
                ))}
                <SelectItem value="space">{staticBackgroundOptionLabel("space")}</SelectItem>
                {orbitPlanetOptions.map((planet) => (
                  <SelectItem key={planet} value={orbitSelectValue(planet)}>
                    {orbitBackgroundOptionLabel(planet)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {assetsMissing && (
        <Alert className="shrink-0 mx-4">
          <AlertTitle>Assets missing</AlertTitle>
          <AlertDescription className="font-mono text-xs">{ASSETS_MISSING_HINT}</AlertDescription>
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
                  1000000
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
            <PreviewExportControls
              blueprint={blueprint}
              exportFormat={exportFormat}
              exportBlob={exportBlob}
              exportError={currentExport?.error}
              controlsDisabled={controlsDisabled}
              downloadPendingLabel={downloadPendingLabel}
            />
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
};
