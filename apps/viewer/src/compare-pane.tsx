import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BlueprintDecodeError,
  blitWithTileCheckerboard,
  decode,
  type BlueprintDocument,
} from "fpsr";
import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { PaneMessage } from "./pane-message";
import { renderPreview } from "./preview-renderer";
import { PreviewCanvasFrame } from "./preview-canvas-frame";
import { ASSETS_MISSING_HINT, isMissingAssetsError } from "./render-errors";
import { comparePreferencesAtom } from "./viewer-preferences";
interface GoldenCase {
  name: string;
  bp: string;
  ppt: number;
  alt?: boolean;
}
export const ComparePane = ({ caseName }: { caseName: string | null }) => {
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const goldenCanvasRef = useRef<HTMLCanvasElement>(null);
  const groundTruthCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayGoldenRef = useRef<HTMLCanvasElement>(null);
  const overlayLiveRef = useRef<HTMLCanvasElement>(null);
  const renderGenRef = useRef(0);
  const [cases, setCases] = useState<GoldenCase[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [loadingRender, setLoadingRender] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsMissing, setAssetsMissing] = useState(false);
  const [goldenUrl, setGoldenUrl] = useState<string | null>(null);
  const [groundTruthUrl, setGroundTruthUrl] = useState<string | null>(null);
  const [groundTruthMissing, setGroundTruthMissing] = useState(false);
  const [comparePreferences, setComparePreferences] = useAtom(comparePreferencesAtom);
  const { overlayOpacity, showDifference } = comparePreferences;
  const setOverlayOpacity = (value: number) => {
    setComparePreferences((previous) => ({ ...previous, overlayOpacity: value }));
  };
  const setShowDifference = (value: boolean) => {
    setComparePreferences((previous) => ({ ...previous, showDifference: value }));
  };
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [blueprintString, setBlueprintString] = useState<string | null>(null);
  const selectedCase = caseName ? (cases.find((c) => c.name === caseName) ?? null) : null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/golden/cases.json");
        if (!res.ok) throw new Error(`Failed to load cases.json (${res.status})`);
        const data = (await res.json()) as GoldenCase[];
        if (cancelled) return;
        setCases(data);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to load golden cases";
        setError(message);
      } finally {
        if (!cancelled) setLoadingCases(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!selectedCase) {
      setGoldenUrl(null);
      setGroundTruthUrl(null);
      setGroundTruthMissing(false);
      setDimensions(null);
      setBlueprintString(null);
      return;
    }
    setBlueprintString(null);
    setGoldenUrl(`/golden/${selectedCase.name}.png`);
    setGroundTruthMissing(false);
    setGroundTruthUrl(null);
    const controller = new AbortController();
    void (async () => {
      const gtUrl = `/ground-truth/${selectedCase.name}.game.png`;
      try {
        const res = await fetch(gtUrl, { method: "HEAD", signal: controller.signal });
        if (res.ok) {
          setGroundTruthUrl(gtUrl);
        } else {
          setGroundTruthMissing(true);
        }
      } catch {
        if (!controller.signal.aborted) setGroundTruthMissing(true);
      }
    })();
    return () => controller.abort();
  }, [selectedCase]);
  useEffect(() => {
    if (!selectedCase) return;
    const gen = ++renderGenRef.current;
    const controller = new AbortController();
    setLoadingRender(true);
    setError(null);
    setAssetsMissing(false);
    void (async () => {
      try {
        const bpRes = await fetch(`/golden/${selectedCase.bp}`, { signal: controller.signal });
        if (!bpRes.ok) throw new Error(`Failed to load ${selectedCase.bp} (${bpRes.status})`);
        const source = (await bpRes.text()).trim();
        if (gen !== renderGenRef.current) return;
        setBlueprintString(source);
        let doc: BlueprintDocument;
        try {
          doc = decode(source);
        } catch (e) {
          const reason =
            e instanceof BlueprintDecodeError
              ? e.reason
              : e instanceof Error
                ? e.message
                : "decode failed";
          throw new Error(`Decode error: ${reason}`);
        }
        const liveCanvas = liveCanvasRef.current;
        if (!liveCanvas) return;
        const renderOptions = {
          pixelsPerTile: selectedCase.ppt,
          altMode: selectedCase.alt ?? true,
          background: null,
          showCheckerboard: true,
          signal: controller.signal,
        };
        const result = await renderPreview(liveCanvas, doc, renderOptions);
        if (gen !== renderGenRef.current) return;
        const overlayCanvas = overlayLiveRef.current;
        if (overlayCanvas) {
          const blob = await result.toPngBlob();
          const bitmap = await createImageBitmap(blob);
          try {
            if (gen === renderGenRef.current) {
              blitWithTileCheckerboard(
                overlayCanvas,
                bitmap,
                result.width,
                result.height,
                selectedCase.ppt,
              );
            }
          } finally {
            bitmap.close();
          }
        }
        if (gen !== renderGenRef.current) return;
        setDimensions({ width: result.width, height: result.height });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (gen !== renderGenRef.current) return;
        const message = e instanceof Error ? e.message : "Render failed";
        setAssetsMissing(isMissingAssetsError(message));
        setError(message);
        setDimensions(null);
      } finally {
        if (gen === renderGenRef.current) {
          setLoadingRender(false);
        }
      }
    })();
    return () => controller.abort();
  }, [selectedCase]);
  useEffect(() => {
    if (!goldenUrl || !selectedCase) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const paint = (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return;
        blitWithTileCheckerboard(canvas, img, width, height, selectedCase.ppt);
      };
      paint(goldenCanvasRef.current);
      paint(overlayGoldenRef.current);
    };
    img.src = goldenUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.src = "";
    };
  }, [goldenUrl, selectedCase]);
  useEffect(() => {
    if (!groundTruthUrl || !selectedCase) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = groundTruthCanvasRef.current;
      if (!canvas) return;
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      blitWithTileCheckerboard(canvas, img, width, height, selectedCase.ppt);
    };
    img.src = groundTruthUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.src = "";
    };
  }, [groundTruthUrl, selectedCase]);
  if (loadingCases) {
    return <PaneMessage loading>Loading golden cases…</PaneMessage>;
  }
  if (cases.length === 0) {
    return <PaneMessage>No golden cases found in fixtures/golden/cases.json.</PaneMessage>;
  }
  if (!caseName) {
    return <PaneMessage>Select a golden sample in the sidebar to compare.</PaneMessage>;
  }
  if (!selectedCase) {
    return <PaneMessage>No golden case named “{caseName}”.</PaneMessage>;
  }
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Alert>
        <AlertDescription>
          Golden approval flow: compare the live render against the game screenshot (when captured),
          then run{" "}
          <code className="font-mono text-xs text-foreground">
            pnpm -F @fpsr/golden-tests run update
          </code>{" "}
          and commit the updated PNGs.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="text-sm font-medium">{selectedCase.name}</span>
        <span className="text-sm text-muted-foreground">
          {selectedCase.bp}
          {selectedCase.alt ? " · alt" : ""} · {selectedCase.ppt} ppt
          {dimensions && (
            <>
              {" · "}
              {dimensions.width}×{dimensions.height}px
            </>
          )}
          {loadingRender && <span className="text-primary"> · rendering…</span>}
        </span>
      </div>

      {blueprintString && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="compare-bp">Blueprint string</Label>
          <Textarea
            id="compare-bp"
            readOnly
            rows={3}
            value={blueprintString}
            spellCheck={false}
            className="min-h-[4.5rem] font-mono text-xs break-all"
          />
        </div>
      )}

      {assetsMissing && (
        <Alert>
          <AlertTitle>Assets missing</AlertTitle>
          <AlertDescription className="font-mono text-xs">{ASSETS_MISSING_HINT}</AlertDescription>
        </Alert>
      )}
      {error && !assetsMissing && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Live render
          </h3>
          <PreviewCanvasFrame
            width={dimensions?.width}
            height={dimensions?.height}
            className="h-64 max-h-64 flex-none"
          >
            <canvas ref={liveCanvasRef} className="size-full [image-rendering:pixelated]" />
          </PreviewCanvasFrame>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Committed golden
          </h3>
          <PreviewCanvasFrame
            width={dimensions?.width}
            height={dimensions?.height}
            className="h-64 max-h-64 flex-none"
          >
            {goldenUrl ? (
              <canvas ref={goldenCanvasRef} className="size-full [image-rendering:pixelated]" />
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No golden PNG
              </div>
            )}
          </PreviewCanvasFrame>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Game ground truth
          </h3>
          <PreviewCanvasFrame
            width={dimensions?.width}
            height={dimensions?.height}
            className="h-64 max-h-64 flex-none"
          >
            {groundTruthUrl ? (
              <canvas
                ref={groundTruthCanvasRef}
                className="size-full [image-rendering:pixelated]"
              />
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {groundTruthMissing ? "No ground truth captured" : "Checking…"}
              </div>
            )}
          </PreviewCanvasFrame>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Overlay
        </h3>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <Label htmlFor="onion-skin" className="whitespace-nowrap">
              Onion skin
            </Label>
            <Slider
              id="onion-skin"
              className="w-36"
              min={0}
              max={100}
              step={1}
              value={[overlayOpacity]}
              onValueChange={(value) =>
                setOverlayOpacity(Array.isArray(value) ? (value[0] ?? 50) : value)
              }
            />
            <span className="min-w-10 text-sm text-muted-foreground tabular-nums">
              {overlayOpacity}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="difference" checked={showDifference} onCheckedChange={setShowDifference} />
            <Label htmlFor="difference">Difference</Label>
          </div>
        </div>
        <PreviewCanvasFrame
          width={dimensions?.width}
          height={dimensions?.height}
          className={cn("h-80 max-h-80 flex-none", showDifference && "bg-black")}
        >
          <div className="relative size-full">
            {goldenUrl && (
              <canvas
                ref={overlayGoldenRef}
                className="relative z-0 size-full [image-rendering:pixelated]"
                aria-hidden
              />
            )}
            <canvas
              ref={overlayLiveRef}
              className={cn(
                "absolute inset-0 z-10 size-full [image-rendering:pixelated]",
                showDifference && "mix-blend-difference opacity-100",
              )}
              style={{ opacity: showDifference ? 1 : overlayOpacity / 100 }}
            />
          </div>
        </PreviewCanvasFrame>
      </div>
    </div>
  );
};
