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
import { useEffect, useRef, useState } from "react";
import { renderPreview } from "./preview-renderer";
import { PreviewCanvasFrame } from "./preview-canvas-frame";
const ASSETS_HINT = "Assets not found — run: pnpm assets:build";
interface GoldenCase {
  name: string;
  bp: string;
  ppt: number;
  alt?: boolean;
}
const isAssetsError = (message: string): boolean => {
  return (
    message.includes("Failed to fetch") ||
    message.includes("404") ||
    message.includes("Not found") ||
    message.includes("ENOENT")
  );
};
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
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [showDifference, setShowDifference] = useState(false);
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
    void (async () => {
      const gtUrl = `/ground-truth/${selectedCase.name}.game.png`;
      try {
        const res = await fetch(gtUrl, { method: "HEAD" });
        if (res.ok) {
          setGroundTruthUrl(gtUrl);
        } else {
          setGroundTruthMissing(true);
        }
      } catch {
        setGroundTruthMissing(true);
      }
    })();
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
        const bpRes = await fetch(`/golden/${selectedCase.bp}`);
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
        const overlayCanvas = overlayLiveRef.current;
        if (!liveCanvas || !overlayCanvas) return;
        const renderOptions = {
          pixelsPerTile: selectedCase.ppt,
          altMode: selectedCase.alt ?? true,
          background: null,
          showCheckerboard: true,
          signal: controller.signal,
        };
        const [result] = await Promise.all([
          renderPreview(liveCanvas, doc, renderOptions),
          renderPreview(overlayCanvas, doc, renderOptions),
        ]);
        if (gen !== renderGenRef.current) return;
        setDimensions({ width: result.width, height: result.height });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (gen !== renderGenRef.current) return;
        const message = e instanceof Error ? e.message : "Render failed";
        setAssetsMissing(isAssetsError(message));
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
    const img = new Image();
    img.onload = () => {
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
  }, [goldenUrl, selectedCase]);
  useEffect(() => {
    if (!groundTruthUrl || !selectedCase) return;
    const img = new Image();
    img.onload = () => {
      const canvas = groundTruthCanvasRef.current;
      if (!canvas) return;
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      blitWithTileCheckerboard(canvas, img, width, height, selectedCase.ppt);
    };
    img.src = groundTruthUrl;
  }, [groundTruthUrl, selectedCase]);
  if (loadingCases) {
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <div className="rounded-lg border border-dashed px-8 py-12 text-center text-muted-foreground">
          Loading golden cases…
        </div>
      </div>
    );
  }
  if (cases.length === 0) {
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <div className="rounded-lg border border-dashed px-8 py-12 text-center text-muted-foreground">
          No golden cases found in fixtures/golden/cases.json.
        </div>
      </div>
    );
  }
  if (!caseName) {
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <div className="rounded-lg border border-dashed px-8 py-12 text-center text-muted-foreground">
          Select a golden sample in the sidebar to compare.
        </div>
      </div>
    );
  }
  if (!selectedCase) {
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <div className="rounded-lg border border-dashed px-8 py-12 text-center text-muted-foreground">
          No golden case named “{caseName}”.
        </div>
      </div>
    );
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
        <div className="space-y-2">
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
          <AlertDescription className="font-mono text-xs">{ASSETS_HINT}</AlertDescription>
        </Alert>
      )}
      {error && !assetsMissing && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
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

        <div className="space-y-2">
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

        <div className="space-y-2">
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

      <div className="space-y-3">
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
