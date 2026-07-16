import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 16;
/** Initial fit never exceeds true size — only zoom out to fit, never zoom in. */
const FIT_ZOOM_MAX = 1;
const ZOOM_BUTTON_STEP = 0.25;
/** Pinch-to-zoom sensitivity: zoom *= exp(-deltaY * step). Higher = faster zoom. */
const PINCH_ZOOM_STEP = 0.01;
/** How far past hard pan bounds the user can drag before it resists (px). */
const RUBBERBAND_DISTANCE = 100;
/** Matches react-viewer-pan-zoom spring.transition. */
const SPRING_TRANSITION = "transform 0.1s ease-out";

type View = { zoom: number; panX: number; panY: number };

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

function fitZoomFor(shellW: number, shellH: number, contentW: number, contentH: number): number {
  return Math.min(shellW / contentW, shellH / contentH, FIT_ZOOM_MAX);
}

/**
 * Hard pan bounds, matching react-viewer-pan-zoom:
 * - Content smaller than the frame on an axis → pan locked to 0 on that axis
 * - Content larger → pan only enough that the content still covers the frame
 *   (max |pan| = (scaledSize - shellSize) / 2 with center-origin transforms)
 */
function clampPan(
  zoom: number,
  panX: number,
  panY: number,
  shellW: number,
  shellH: number,
  contentW: number,
  contentH: number,
): { panX: number; panY: number } {
  const scaledW = contentW * zoom;
  const scaledH = contentH * zoom;
  const maxX = Math.max(0, (scaledW - shellW) / 2);
  const maxY = Math.max(0, (scaledH - shellH) / 2);
  return {
    panX: Math.min(maxX, Math.max(-maxX, panX)),
    panY: Math.min(maxY, Math.max(-maxY, panY)),
  };
}

/** Allow overscroll past hard pan bounds by `distance` (rubberband while dragging). */
function rubberbandPan(
  zoom: number,
  panX: number,
  panY: number,
  shellW: number,
  shellH: number,
  contentW: number,
  contentH: number,
  distance: number,
): { panX: number; panY: number } {
  const hard = clampPan(zoom, panX, panY, shellW, shellH, contentW, contentH);
  return {
    panX: Math.min(hard.panX + distance, Math.max(hard.panX - distance, panX)),
    panY: Math.min(hard.panY + distance, Math.max(hard.panY - distance, panY)),
  };
}

function ViewerToolbar({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
}) {
  return (
    <div
      data-no-pan
      className="pointer-events-auto absolute bottom-3 left-3 z-10 rounded-lg bg-background/90 shadow-sm backdrop-blur-sm"
    >
      <ButtonGroup>
        <Button variant="outline" size="icon" onClick={onZoomOut} aria-label="Zoom out">
          <Minus />
        </Button>
        <ButtonGroupText className="bg-primary-background border min-w-10 text-xs tabular-nums">
          {(zoom * 100).toFixed(0)}%
        </ButtonGroupText>
        <Button variant="outline" size="icon" onClick={onZoomIn} aria-label="Zoom in">
          <Plus />
        </Button>
        <Button variant="outline" size="icon" onClick={onReset} aria-label="Reset view">
          <RotateCcw />
        </Button>
      </ButtonGroup>
    </div>
  );
}

/** Bounded frame for rendered canvases. 100% zoom = true pixel size of the render. */
export function PreviewCanvasFrame({
  className,
  actions,
  overlay,
  width,
  height,
  children,
}: {
  /** Render pixel size — used as the 100% zoom baseline and for one-time fit. */
  width?: number;
  height?: number;
  className?: string;
  actions?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fitZoomRef = useRef(1);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);

  const [fitKey, setFitKey] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);
  /** Spring enabled only after the initial fit has painted — avoids zoom-in flash. */
  const [spring, setSpring] = useState(false);

  const contentKey =
    width != null && height != null && width > 0 && height > 0 ? `${width}x${height}` : null;
  const ready = contentKey != null && fitKey === contentKey;

  sizeRef.current = { width: width ?? 0, height: height ?? 0 };

  const commitView = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const applyZoomAt = useCallback(
    (nextZoom: number, originX: number, originY: number) => {
      const shell = shellRef.current;
      const { width: contentW, height: contentH } = sizeRef.current;
      if (!shell || contentW <= 0 || contentH <= 0) return;
      const { clientWidth: shellW, clientHeight: shellH } = shell;
      const prev = viewRef.current;
      const zoom = clampZoom(nextZoom);
      const scale = zoom / prev.zoom;
      const panX = originX - (originX - prev.panX) * scale;
      const panY = originY - (originY - prev.panY) * scale;
      const pan = clampPan(zoom, panX, panY, shellW, shellH, contentW, contentH);
      commitView({ zoom, ...pan });
    },
    [commitView],
  );

  useLayoutEffect(() => {
    if (!contentKey || width == null || height == null) {
      fitZoomRef.current = 1;
      setFitKey(null);
      setSpring(false);
      commitView({ zoom: 1, panX: 0, panY: 0 });
      return;
    }

    const el = shellRef.current;
    if (!el) return;

    const measure = (): boolean => {
      if (fitKey === contentKey) return true;
      const { clientWidth, clientHeight } = el;
      if (clientWidth <= 0 || clientHeight <= 0) return false;
      const zoom = fitZoomFor(clientWidth, clientHeight, width, height);
      if (!Number.isFinite(zoom) || zoom <= 0) return false;
      fitZoomRef.current = zoom;
      setSpring(false);
      commitView({ zoom, panX: 0, panY: 0 });
      setFitKey(contentKey);
      return true;
    };

    if (measure()) return;

    const ro = new ResizeObserver(() => {
      if (measure()) ro.disconnect();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentKey, width, height, fitKey, commitView]);

  // Turn spring on after the fitted frame is on screen (double rAF ≈ after paint).
  useEffect(() => {
    if (!ready) {
      setSpring(false);
      return;
    }
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setSpring(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [ready, fitKey]);

  // Re-clamp pan if the shell size changes, but never re-fit zoom.
  useEffect(() => {
    const el = shellRef.current;
    if (!el || width == null || height == null || !ready) return;
    const ro = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = el;
      if (clientWidth <= 0 || clientHeight <= 0) return;
      const prev = viewRef.current;
      const pan = clampPan(
        prev.zoom,
        prev.panX,
        prev.panY,
        clientWidth,
        clientHeight,
        width,
        height,
      );
      if (pan.panX !== prev.panX || pan.panY !== prev.panY) {
        commitView({ zoom: prev.zoom, ...pan });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, width, height, commitView]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "r" || event.key === "R") {
        commitView({ zoom: fitZoomRef.current, panX: 0, panY: 0 });
      } else if (event.key === "c" || event.key === "C") {
        const shell = shellRef.current;
        const { width: contentW, height: contentH } = sizeRef.current;
        if (!shell || contentW <= 0 || contentH <= 0) {
          commitView({ ...viewRef.current, panX: 0, panY: 0 });
          return;
        }
        const pan = clampPan(
          viewRef.current.zoom,
          0,
          0,
          shell.clientWidth,
          shell.clientHeight,
          contentW,
          contentH,
        );
        commitView({ zoom: viewRef.current.zoom, ...pan });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commitView]);

  // Native pointer listeners so dragging works even when the canvas is the event target.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !ready) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Ignore drags that start on overlay controls.
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, [data-no-pan]")) return;

      event.preventDefault();
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: viewRef.current.panX,
        panY: viewRef.current.panY,
      };
      setDragging(true);
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic / non-active pointers (tests) may reject capture; drag still works via bubbling.
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const shell = shellRef.current;
      const { width: contentW, height: contentH } = sizeRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !shell || contentW <= 0 || contentH <= 0) {
        return;
      }
      event.preventDefault();
      const panX = drag.panX + (event.clientX - drag.x);
      const panY = drag.panY + (event.clientY - drag.y);
      // Rubberband past hard bounds while dragging; spring snaps back on release.
      const pan = rubberbandPan(
        viewRef.current.zoom,
        panX,
        panY,
        shell.clientWidth,
        shell.clientHeight,
        contentW,
        contentH,
        RUBBERBAND_DISTANCE,
      );
      commitView({ zoom: viewRef.current.zoom, ...pan });
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }

      // Snap back from rubberband overscroll with spring transition.
      const shell = shellRef.current;
      const { width: contentW, height: contentH } = sizeRef.current;
      if (!shell || contentW <= 0 || contentH <= 0) return;
      const prev = viewRef.current;
      const pan = clampPan(
        prev.zoom,
        prev.panX,
        prev.panY,
        shell.clientWidth,
        shell.clientHeight,
        contentW,
        contentH,
      );
      if (pan.panX !== prev.panX || pan.panY !== prev.panY) {
        commitView({ zoom: prev.zoom, ...pan });
      }
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerUp);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerUp);
    };
  }, [ready, commitView]);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!ready) return;
      // Trackpad pinch sets ctrlKey; two-finger scroll should bubble to the page.
      if (!event.ctrlKey) return;

      event.preventDefault();
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const originX = event.clientX - rect.left - rect.width / 2;
      const originY = event.clientY - rect.top - rect.height / 2;
      const factor = Math.exp(-event.deltaY * PINCH_ZOOM_STEP);
      applyZoomAt(viewRef.current.zoom * factor, originX, originY);
    },
    [applyZoomAt, ready],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      applyZoomAt(viewRef.current.zoom + delta, 0, 0);
    },
    [applyZoomAt],
  );

  const onReset = useCallback(() => {
    commitView({ zoom: fitZoomRef.current, panX: 0, panY: 0 });
  }, [commitView]);

  const transition = spring && !dragging ? SPRING_TRANSITION : "none";

  return (
    <div
      ref={shellRef}
      className={cn("relative min-h-0 min-w-0 flex-1 overflow-hidden", className)}
    >
      <div
        ref={viewportRef}
        className={cn(
          "absolute inset-0 touch-none overflow-hidden select-none",
          ready ? (dragging ? "cursor-grabbing" : "cursor-grab") : "opacity-0",
        )}
        onWheel={onWheel}
      >
        <div
          className="absolute top-1/2 left-1/2 will-change-transform"
          style={{
            width: width ?? 1,
            height: height ?? 1,
            // Mount the render surface immediately, but hide it until the first
            // result supplies dimensions and the fitted transform is known.
            visibility: ready ? "visible" : "hidden",
            transform: `translate(calc(-50% + ${view.panX}px), calc(-50% + ${view.panY}px)) scale(${view.zoom})`,
            transformOrigin: "center center",
            transition,
          }}
        >
          {children}
        </div>
      </div>

      {overlay != null && (
        <div data-no-pan className="absolute inset-0 flex items-center justify-center p-6">
          {overlay}
        </div>
      )}

      {ready && (
        <ViewerToolbar
          zoom={view.zoom}
          onZoomOut={() => zoomBy(-ZOOM_BUTTON_STEP)}
          onZoomIn={() => zoomBy(ZOOM_BUTTON_STEP)}
          onReset={onReset}
        />
      )}
      {actions != null && (
        <div data-no-pan className="pointer-events-auto absolute bottom-3 right-3 z-10">
          {actions}
        </div>
      )}
    </div>
  );
}
