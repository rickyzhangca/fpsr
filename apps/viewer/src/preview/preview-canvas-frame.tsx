import { cn } from "@/lib/utils";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cornerRadiiToCss, effectiveClipCornerRadii, type CornerRadii } from "./clip-corner-radii";
import {
  PINCH_ZOOM_STEP,
  RUBBERBAND_DISTANCE,
  SPRING_TRANSITION,
  ZOOM_BUTTON_STEP,
  clampPan,
  clampZoom,
  fitZoomFor,
  rubberbandPan,
  type View,
} from "./pan-zoom";
import type { TiledPreviewViewport } from "./preview-tiles";
import { ViewerToolbar } from "./viewer-toolbar";

const ZERO_RADII: CornerRadii = { tl: 0, tr: 0, br: 0, bl: 0 };

export const PreviewCanvasFrame = ({
  className,
  actions,
  overlay,
  width,
  height,
  onViewportSizeChange,
  onViewChange,
  viewportLayer,
  children,
}: {
  /** Render pixel size — used as the 100% zoom baseline and for one-time fit. */
  width?: number;
  height?: number;
  onViewportSizeChange?: (size: { width: number; height: number }) => void;
  onViewChange?: (viewport: TiledPreviewViewport | null) => void;
  className?: string;
  actions?: ReactNode;
  overlay?: ReactNode;
  viewportLayer?: ReactNode;
  children: ReactNode;
}) => {
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
  /** Plain wheel zooms only after the canvas is armed (clicked). Pinch always zooms. */
  const wheelZoomArmedRef = useRef(false);
  const [wheelZoomArmed, setWheelZoomArmed] = useState(false);
  const [armedCornerRadii, setArmedCornerRadii] = useState<CornerRadii>(ZERO_RADII);
  const [fitKey, setFitKey] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
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
  useEffect(() => {
    const element = shellRef.current;
    if (!element) return;
    let lastWidth = 0;
    let lastHeight = 0;
    const report = () => {
      if (element.clientWidth <= 0 || element.clientHeight <= 0) return;
      const size = { width: element.clientWidth, height: element.clientHeight };
      if (size.width === lastWidth && size.height === lastHeight) return;
      lastWidth = size.width;
      lastHeight = size.height;
      setViewportSize(size);
      onViewportSizeChange?.(size);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onViewportSizeChange]);
  useEffect(() => {
    if (!onViewChange) return;
    if (!ready || viewportSize.width <= 0 || viewportSize.height <= 0) {
      onViewChange(null);
      return;
    }
    onViewChange({ ...view, ...viewportSize });
  }, [onViewChange, ready, view, viewportSize]);
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

    let onWindowPointerUp: (event: PointerEvent) => void = () => {};

    const detachWindowDragListeners = () => {
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    };

    const endDrag = (pointerId: number) => {
      if (dragRef.current?.pointerId !== pointerId) return;
      dragRef.current = null;
      setDragging(false);
      detachWindowDragListeners();
      if (viewport.hasPointerCapture(pointerId)) {
        viewport.releasePointerCapture(pointerId);
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

    onWindowPointerUp = (event: PointerEvent) => {
      endDrag(event.pointerId);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Ignore drags that start on overlay controls.
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, [data-no-pan]")) return;
      event.preventDefault();
      wheelZoomArmedRef.current = true;
      setWheelZoomArmed(true);
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: viewRef.current.panX,
        panY: viewRef.current.panY,
      };
      setDragging(true);
      // Window fallback so release outside the viewport still ends the drag
      // when setPointerCapture fails or is lost.
      detachWindowDragListeners();
      window.addEventListener("pointerup", onWindowPointerUp);
      window.addEventListener("pointercancel", onWindowPointerUp);
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic / non-active pointers (tests) may reject capture; drag still works via bubbling.
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      // Release outside can miss pointerup; clear stale drag when no buttons are held.
      if (event.buttons === 0) {
        endDrag(event.pointerId);
        return;
      }
      const shell = shellRef.current;
      const { width: contentW, height: contentH } = sizeRef.current;
      if (!shell || contentW <= 0 || contentH <= 0) return;
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
      endDrag(event.pointerId);
    };
    const onLostPointerCapture = (event: PointerEvent) => {
      endDrag(event.pointerId);
    };
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerUp);
    viewport.addEventListener("lostpointercapture", onLostPointerCapture);
    return () => {
      detachWindowDragListeners();
      if (dragRef.current) {
        dragRef.current = null;
        setDragging(false);
      }
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerUp);
      viewport.removeEventListener("lostpointercapture", onLostPointerCapture);
    };
  }, [ready, commitView]);
  // Native non-passive listeners: React's onWheel is passive, so preventDefault
  // cannot stop browser page-zoom on trackpad pinch / Safari gesture events.
  //
  // Mouse vs trackpad cannot be told apart from wheel events, so we use intent:
  // - Pinch / ctrl+wheel → always zoom
  // - Plain wheel → zoom only after the canvas was clicked (armed); otherwise scroll
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !ready) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !wheelZoomArmedRef.current) return;
      event.preventDefault();
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const originX = event.clientX - rect.left - rect.width / 2;
      const originY = event.clientY - rect.top - rect.height / 2;
      const factor = Math.exp(-event.deltaY * PINCH_ZOOM_STEP);
      applyZoomAt(viewRef.current.zoom * factor, originX, originY);
    };
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };
    const onPointerDownOutside = (event: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell) return;
      if (event.target instanceof Node && shell.contains(event.target)) return;
      wheelZoomArmedRef.current = false;
      setWheelZoomArmed(false);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    // Safari pinch-zoom fires gesture* instead of (or in addition to) wheel.
    viewport.addEventListener("gesturestart", preventGesture);
    viewport.addEventListener("gesturechange", preventGesture);
    viewport.addEventListener("gestureend", preventGesture);
    document.addEventListener("pointerdown", onPointerDownOutside, true);
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", preventGesture);
      viewport.removeEventListener("gesturechange", preventGesture);
      viewport.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
    };
  }, [ready, applyZoomAt]);
  // Match the armed focus border to any rounded clipping ancestor (e.g. main's rounded-xl).
  useLayoutEffect(() => {
    if (!wheelZoomArmed) {
      setArmedCornerRadii(ZERO_RADII);
      return;
    }
    const shell = shellRef.current;
    if (!shell) return;
    const sync = () => setArmedCornerRadii(effectiveClipCornerRadii(shell));
    sync();
    const parents: HTMLElement[] = [];
    let node: HTMLElement | null = shell.parentElement;
    while (node) {
      parents.push(node);
      node = node.parentElement;
    }
    window.addEventListener("resize", sync);
    for (const parent of parents) {
      parent.addEventListener("scroll", sync, { passive: true });
    }
    const observer = new ResizeObserver(sync);
    observer.observe(shell);
    for (const parent of parents) observer.observe(parent);
    return () => {
      window.removeEventListener("resize", sync);
      for (const parent of parents) {
        parent.removeEventListener("scroll", sync);
      }
      observer.disconnect();
    };
  }, [wheelZoomArmed]);
  const zoomBy = (delta: number) => {
    applyZoomAt(viewRef.current.zoom + delta, 0, 0);
  };
  const onReset = () => {
    commitView({ zoom: fitZoomRef.current, panX: 0, panY: 0 });
  };
  const transition = viewportLayer == null && spring && !dragging ? SPRING_TRANSITION : "none";
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
        {ready && viewportLayer != null && (
          <div className="pointer-events-none absolute inset-0">{viewportLayer}</div>
        )}
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
      {wheelZoomArmed && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 border-2 border-ring"
          style={{ borderRadius: cornerRadiiToCss(armedCornerRadii) }}
        />
      )}
    </div>
  );
};
