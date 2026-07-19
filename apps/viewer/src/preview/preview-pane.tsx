import { formatGameVersion } from "@/blueprint/blueprint-meta";
import { clearFactorioItemIconCache } from "@/blueprint/factorio-item-icon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PerfReport } from "@/performance/perf-report";
import { canUseLocalAssets, type AssetOrigin } from "@/shell/asset-config";
import { setViewerAssetOrigin, viewerAssets } from "@/shell/viewer-assets";
import { previewPreferencesAtom, type PreviewBackgroundMode } from "@/shell/viewer-preferences";
import {
  countBlueprintComponents,
  type Blueprint,
  type BlueprintDocument,
  type DecodeStats,
  type RenderMeasurement,
} from "fpsr";
import { useAtom } from "jotai";
import { InfoIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  toRenderBackground,
} from "./background-controls";
import { PreviewExportControls } from "./export-controls";
import { EXPORT_OPTIONS, formatTileSize, resultPixelsPerTile, type ExportFormat } from "./format";
import { PreviewCanvasFrame } from "./preview-canvas-frame";
import {
  clearPreview,
  exportFullResolutionPng,
  measurePreview,
  renderPreview,
  setPreviewAssetOrigin,
  type PreviewRenderResult,
} from "./preview-renderer";
import type { TiledPreviewViewport } from "./preview-tiles";
import { ASSETS_MISSING_HINT, isMissingAssetsError } from "./render-errors";
import type { PreviewRenderProgress, WorkerTiledPreviewOptions } from "./render-worker-protocol";
import { TiledPreviewLayer } from "./tiled-preview-layer";

const FULL_PIXELS_PER_TILE = 64;
const MAX_OUTPUT_SIZE = { width: 4096, height: 4096 } as const;
const MAX_PREVIEW_EDGE = 8192;
const MAX_PREVIEW_PIXELS = 32_000_000;
const PREVIEW_OVERSCAN = 2;

const adaptivePreviewSize = (viewport: { width: number; height: number }) => {
  const density = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let width = Math.min(
    MAX_PREVIEW_EDGE,
    Math.max(1024, viewport.width * density * PREVIEW_OVERSCAN),
  );
  let height = Math.min(
    MAX_PREVIEW_EDGE,
    Math.max(1024, viewport.height * density * PREVIEW_OVERSCAN),
  );
  const pixels = width * height;
  if (pixels > MAX_PREVIEW_PIXELS) {
    const scale = Math.sqrt(MAX_PREVIEW_PIXELS / pixels);
    width *= scale;
    height *= scale;
  }
  return { width: Math.floor(width), height: Math.floor(height) };
};

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
    key: object;
    promises: Partial<Record<ExportFormat, Promise<Blob>>>;
  } | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [previewPreferences, setPreviewPreferences] = useAtom(previewPreferencesAtom);
  const {
    limitTo4k,
    exportFormat,
    altMode,
    showCoords,
    showBackground,
    useCdnAssets,
    backgroundMode,
    orbitPlanet,
  } = previewPreferences;
  const setLimitTo4k = (value: boolean) => {
    if (value) {
      setTiledViewport(null);
    }
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
  const setUseCdnAssets = (value: boolean) => {
    if (!canUseLocalAssets()) return;
    setPreviewPreferences((previous) => ({ ...previous, useCdnAssets: value }));
  };
  const setBackgroundSelection = (mode: PreviewBackgroundMode, planet?: string) => {
    setPreviewPreferences((previous) => ({
      ...previous,
      backgroundMode: mode,
      ...(planet != null ? { orbitPlanet: planet } : {}),
    }));
  };
  const localAssetsAvailable = canUseLocalAssets();
  const effectiveUseCdnAssets = localAssetsAvailable ? useCdnAssets : true;
  const assetOrigin: AssetOrigin = effectiveUseCdnAssets ? "cdn" : "local";
  const [orbitPlanets, setOrbitPlanets] = useState<string[]>([...DEFAULT_ORBIT_PLANETS]);
  const [terrainModes, setTerrainModes] = useState<string[]>([...TERRAIN_BACKGROUND_MODES]);
  const [loading, setLoading] = useState(false);
  const [measuringFull, setMeasuringFull] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [exportProgressLabel, setExportProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assetsMissing, setAssetsMissing] = useState(false);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [lastResult, setLastResult] = useState<PreviewRenderResult | null>(null);
  const [fullMeasurement, setFullMeasurement] = useState<RenderMeasurement | null>(null);
  const [tiledViewport, setTiledViewport] = useState<TiledPreviewViewport | null>(null);
  const [previewMaxOutput, setPreviewMaxOutput] = useState<{ width: number; height: number }>(
    MAX_OUTPUT_SIZE,
  );
  const previewMaxOutputRef = useRef(previewMaxOutput);
  previewMaxOutputRef.current = previewMaxOutput;
  // Keep parent callbacks off effect deps — new identities (or Alert-driven
  // viewport size changes) must not restart a failed render in a loop.
  const onTileSizeChangeRef = useRef(onTileSizeChange);
  onTileSizeChangeRef.current = onTileSizeChange;
  const onPerfReportRef = useRef(onPerfReport);
  onPerfReportRef.current = onPerfReport;
  const onRenderProgressRef = useRef(onRenderProgress);
  onRenderProgressRef.current = onRenderProgress;
  const onRenderErrorRef = useRef(onRenderError);
  onRenderErrorRef.current = onRenderError;
  const [preparedExports, setPreparedExports] = useState<{
    key: object;
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
    setViewerAssetOrigin(assetOrigin);
    clearFactorioItemIconCache();
    void setPreviewAssetOrigin(assetOrigin).catch(() => undefined);
  }, [assetOrigin]);
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
  }, [assetOrigin]);
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
  const renderBackground = useMemo(
    () => toRenderBackground(showBackground, backgroundMode, orbitPlanet),
    [showBackground, backgroundMode, orbitPlanet],
  );
  const tiledPreviewOptions = useMemo<WorkerTiledPreviewOptions>(
    () => ({
      blueprintPath: blueprintPath ?? undefined,
      padTiles: 1,
      altMode,
      background: renderBackground,
      showCoordinates: showCoords,
    }),
    [blueprintPath, altMode, renderBackground, showCoords],
  );
  useEffect(() => {
    onTileSizeChangeRef.current?.(formatTileSize(lastResult));
  }, [lastResult]);
  const effectiveExportFormat: ExportFormat = limitTo4k ? exportFormat : "png";
  const exportKey = limitTo4k ? lastResult : fullMeasurement;
  const prepareCurrentExport = useCallback(async (): Promise<Blob> => {
    if (!doc || !lastResult || !exportKey) throw new Error("No rendered blueprint is available");
    const prepared =
      preparedExports?.key === exportKey
        ? preparedExports.formats[effectiveExportFormat]
        : undefined;
    if (prepared?.blob) return prepared.blob;

    let cache = exportPromisesRef.current;
    if (cache?.key !== exportKey) {
      exportAbortRef.current?.abort();
      cache = { key: exportKey, promises: {} };
      exportPromisesRef.current = cache;
      setPreparedExports({ key: exportKey, formats: {} });
    }
    const cachedPromise = cache.promises[effectiveExportFormat];
    if (cachedPromise) return cachedPromise;

    setExportPending(true);
    setExportProgressLabel(limitTo4k ? "Encoding" : "Preparing full-resolution PNG");
    const controller = new AbortController();
    if (!limitTo4k) exportAbortRef.current = controller;
    const promise = limitTo4k
      ? lastResult.toImageBlob(EXPORT_OPTIONS[effectiveExportFormat])
      : exportFullResolutionPng(doc, {
          ...tiledPreviewOptions,
          pixelsPerTile: FULL_PIXELS_PER_TILE,
          signal: controller.signal,
          onProgress(progress) {
            setExportProgressLabel(progress.label);
            onRenderProgressRef.current?.(progress);
          },
        }).then((result) => result.blob);
    cache.promises[effectiveExportFormat] = promise;

    try {
      const blob = await promise;
      if (exportPromisesRef.current?.key === exportKey) {
        setPreparedExports((current) => ({
          key: exportKey,
          formats: {
            ...(current?.key === exportKey ? current.formats : {}),
            [effectiveExportFormat]: { blob },
          },
        }));
      }
      return blob;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Image encoding failed";
      if (exportPromisesRef.current?.key === exportKey) {
        delete exportPromisesRef.current.promises[effectiveExportFormat];
        setPreparedExports((current) => ({
          key: exportKey,
          formats: {
            ...(current?.key === exportKey ? current.formats : {}),
            [effectiveExportFormat]: { error: message },
          },
        }));
      }
      throw reason;
    } finally {
      if (exportPromisesRef.current?.key === exportKey) {
        setExportPending(false);
        setExportProgressLabel(null);
        if (!limitTo4k) onRenderProgressRef.current?.(null);
      }
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
    }
  }, [
    doc,
    lastResult,
    exportKey,
    preparedExports,
    effectiveExportFormat,
    limitTo4k,
    tiledPreviewOptions,
  ]);
  useEffect(() => {
    if (!limitTo4k || !lastResult) return;
    const prepared =
      preparedExports?.key === lastResult
        ? preparedExports.formats[effectiveExportFormat]
        : undefined;
    if (prepared?.blob || prepared?.error) return;
    void prepareCurrentExport().catch(() => undefined);
  }, [limitTo4k, lastResult, effectiveExportFormat, preparedExports, prepareCurrentExport]);
  useEffect(() => {
    return () => exportAbortRef.current?.abort();
  }, []);
  const currentExport =
    preparedExports?.key === exportKey ? preparedExports.formats[effectiveExportFormat] : undefined;
  const exportBlob = currentExport?.blob;
  const controlsDisabled = loading || measuringFull || exportPending || !lastResult || !exportKey;
  const downloadPendingLabel =
    !lastResult || loading ? "Rendering" : measuringFull ? "Measuring" : exportProgressLabel;
  useEffect(() => {
    if (!doc || !blueprint) {
      setDimensions(null);
      setLastResult(null);
      setFullMeasurement(null);
      setError(null);
      setAssetsMissing(false);
      setHoverTile(null);
      onTileSizeChangeRef.current?.("—");
      onPerfReportRef.current?.(null);
      onRenderProgressRef.current?.(null);
      onRenderErrorRef.current?.(null);
      const canvas = canvasRef.current;
      if (canvas) {
        clearPreview(canvas);
      }
      return;
    }
    const gen = ++renderGenRef.current;
    const controller = new AbortController();
    setError(null);
    onRenderErrorRef.current?.(null);
    setAssetsMissing(false);
    if (!showCoords) setHoverTile(null);
    let timer: number | undefined;
    const renderOptions = {
      ...tiledPreviewOptions,
      pixelsPerTile: FULL_PIXELS_PER_TILE,
      profile: true,
    } as const;
    const startRender = () => {
      setLoading(true);
      onRenderProgressRef.current?.({ value: 1, label: "Queued" });
      timer = window.setTimeout(() => {
        const finishRender = (completed: boolean) => {
          if (gen !== renderGenRef.current) return;
          setLoading(false);
          if (!completed) onRenderProgressRef.current?.(null);
        };
        const display = canvasRef.current;
        if (!display) {
          finishRender(false);
          return;
        }
        void (async () => {
          try {
            await setPreviewAssetOrigin(assetOrigin);
          } catch (reason: unknown) {
            if (gen !== renderGenRef.current) return;
            const message =
              reason instanceof Error ? reason.message : "Failed to switch asset source";
            setError(message);
            onRenderErrorRef.current?.(message);
            finishRender(false);
            return;
          }
          if (gen !== renderGenRef.current || controller.signal.aborted) {
            finishRender(false);
            return;
          }
          try {
            const result = await renderPreview(display, doc, {
              ...renderOptions,
              maxOutputSize: previewMaxOutputRef.current,
              signal: controller.signal,
              onProgress: (progress) => onRenderProgressRef.current?.(progress),
            });
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
              onPerfReportRef.current?.(report);
            }
            setDimensions({ width: result.width, height: result.height });
            setLastResult(result);
            onRenderProgressRef.current?.({
              value: 100,
              label: "Complete",
              durationMs: result.wallMs,
            });
            finishRender(true);
          } catch (e: unknown) {
            if (controller.signal.aborted) {
              finishRender(false);
              return;
            }
            if (gen !== renderGenRef.current) return;
            const message = e instanceof Error ? e.message : "Render failed";
            setAssetsMissing(isMissingAssetsError(message));
            setError(message);
            onRenderErrorRef.current?.(message);
            setDimensions(null);
            setLastResult(null);
            setHoverTile(null);
            onPerfReportRef.current?.(null);
            finishRender(false);
          }
        })();
      }, 150);
    };
    startRender();
    return () => {
      if (timer != null) window.clearTimeout(timer);
      controller.abort();
    };
  }, [doc, blueprint, tiledPreviewOptions, showCoords, decodeStats, assetOrigin]);
  useEffect(() => {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    exportPromisesRef.current = null;
    setPreparedExports(null);
    setExportPending(false);
    setExportProgressLabel(null);
  }, [limitTo4k]);
  useEffect(() => {
    if (!doc || limitTo4k) {
      setFullMeasurement(null);
      setMeasuringFull(false);
      return;
    }
    let stale = false;
    setFullMeasurement(null);
    setMeasuringFull(true);
    setError(null);
    onRenderProgressRef.current?.({ value: 3, label: "Measuring full-resolution output" });
    void (async () => {
      try {
        await setPreviewAssetOrigin(assetOrigin);
        if (stale) return;
        const measurement = await measurePreview(doc, {
          ...tiledPreviewOptions,
          pixelsPerTile: FULL_PIXELS_PER_TILE,
        });
        if (stale) return;
        setFullMeasurement(measurement);
        setMeasuringFull(false);
        onRenderProgressRef.current?.(null);
      } catch (reason: unknown) {
        if (stale) return;
        const message = reason instanceof Error ? reason.message : "Size check failed";
        setFullMeasurement(null);
        setMeasuringFull(false);
        setError(message);
        onRenderErrorRef.current?.(message);
        onRenderProgressRef.current?.(null);
      }
    })();
    return () => {
      stale = true;
    };
  }, [doc, limitTo4k, tiledPreviewOptions, assetOrigin]);
  const handleViewportSizeChange = useCallback((size: { width: number; height: number }) => {
    const next = adaptivePreviewSize(size);
    setPreviewMaxOutput((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    );
  }, []);
  const handleTiledViewportChange = useCallback((viewport: TiledPreviewViewport | null) => {
    setTiledViewport(viewport);
  }, []);
  const handleTiledPreviewError = useCallback((reason: Error) => {
    if (reason.name === "AbortError") return;
    setError(reason.message);
    onRenderErrorRef.current?.(reason.message);
  }, []);
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
  const frameDimensions = !limitTo4k && fullMeasurement ? fullMeasurement : dimensions;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            id="limit-to-4k"
            checked={limitTo4k}
            disabled={controlsDisabled}
            onCheckedChange={setLimitTo4k}
          />
          <Label htmlFor="limit-to-4k" className="gap-1.5">
            Limit to 4K
            <span className="text-muted-foreground">
              {!limitTo4k && fullMeasurement
                ? `${fullMeasurement.width}×${fullMeasurement.height}px`
                : dimensions && `${dimensions.width}×${dimensions.height}px`}
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label="About resolution limits"
                  />
                }
              >
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm text-pretty">
                When enabled, preview and export are capped to 4K resolution. When disabled, the
                full image is shown as a tiled preview. Visible tiles load as you zoom or pan like
                Google Maps.
              </TooltipContent>
            </Tooltip>
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="export-format"
            aria-label="Use WebP image format"
            size="sm"
            checked={effectiveExportFormat === "webp"}
            disabled={controlsDisabled || !limitTo4k}
            onCheckedChange={(checked) => setExportFormat(checked ? "webp" : "png")}
          />
          <Label htmlFor="export-format" className="gap-1.5">
            WebP
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label="About WebP format"
                  />
                }
              >
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm text-pretty">
                WebP provides smaller file size, but takes longer to encode. Can be enabled when
                Limit to 4K is enabled.
              </TooltipContent>
            </Tooltip>
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            id="cdn-assets"
            checked={effectiveUseCdnAssets}
            disabled={!localAssetsAvailable || loading || measuringFull || exportPending}
            onCheckedChange={(checked) => {
              setLoading(true);
              setUseCdnAssets(checked);
            }}
          />
          <Label htmlFor="cdn-assets" className="gap-1.5">
            CDN
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label="About CDN assets"
                  />
                }
              >
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm text-pretty">
                {localAssetsAvailable
                  ? "When enabled, atlases and the render database load from the BunnyCDN."
                  : "Deployed builds always load atlases and the render database from the BunnyCDN."}
              </TooltipContent>
            </Tooltip>
          </Label>
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
        <Alert className="mx-4 w-fit shrink-0 self-start">
          <AlertTitle>Assets missing</AlertTitle>
          <AlertDescription className="font-mono text-xs">{ASSETS_MISSING_HINT}</AlertDescription>
        </Alert>
      )}
      {error && !assetsMissing && (
        <Alert className="mx-4 w-fit max-w-full shrink-0 self-start" variant="destructive">
          <AlertTitle>Render error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <PreviewCanvasFrame
        width={frameDimensions?.width}
        height={frameDimensions?.height}
        onViewportSizeChange={handleViewportSizeChange}
        onViewChange={!limitTo4k ? handleTiledViewportChange : undefined}
        viewportLayer={
          !limitTo4k && fullMeasurement && tiledViewport ? (
            <TiledPreviewLayer
              key={assetOrigin}
              doc={doc}
              options={tiledPreviewOptions}
              measurement={fullMeasurement}
              viewport={tiledViewport}
              onError={handleTiledPreviewError}
            />
          ) : null
        }
        actions={
          <PreviewExportControls
            blueprint={blueprint}
            exportFormat={effectiveExportFormat}
            exportBlob={exportBlob}
            exportError={currentExport?.error}
            controlsDisabled={controlsDisabled}
            downloadPendingLabel={downloadPendingLabel}
            fullResolution={!limitTo4k}
            prepareExport={prepareCurrentExport}
          />
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
