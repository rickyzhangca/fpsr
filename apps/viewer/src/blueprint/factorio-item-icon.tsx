import { cn } from "@/lib/utils";
import { resolveIconFrameId, type FrameMeta, type RenderDb } from "fpsr";
import { bakeEntityInfoSilhouette, entityInfoSilhouettePadPx } from "fpsr/canvas";
import { useEffect, useState, type CSSProperties } from "react";
import { viewerAssets as assets } from "@/shell/viewer-assets";
/** Alt-mode entity-info silhouette defaults (see `icon-silhouette.ts`). */
const ALT_MODE_SILHOUETTE_DILATE_RADIUS = 12;
const ALT_MODE_SILHOUETTE_BLUR_RADIUS = 16;
/** Matches `QUALITY_SIGNAL_OVERLAY_FRACTION` in alt-mode.ts. */
const QUALITY_BADGE_SIZE_FRACTION = 0.5;
const QUALITY_BADGE_OFFSET_X_FRACTION = -0.3;
const QUALITY_BADGE_OFFSET_Y_FRACTION = 0.3;
export interface SilhouetteConfig {
  dilateRadius: number;
  blurRadius: number;
  /** Silhouette opacity from 0 (invisible) to 1 (full black). Default 1. */
  intensity?: number;
}
interface ResolvedSilhouette {
  dilateRadius: number;
  blurRadius: number;
  intensity: number;
}
interface LoadedIcon {
  url: string;
  frameW: number;
  frameH: number;
  pad: number;
}
const urlCache = new Map<string, Promise<LoadedIcon | null>>();
const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
const cropFrameToCanvas = (atlas: CanvasImageSource, frame: FrameMeta): HTMLCanvasElement => {
  const canvas = createCanvas(frame.sw, frame.sh);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(
      atlas,
      frame.x,
      frame.y,
      frame.pw ?? frame.w,
      frame.ph ?? frame.h,
      frame.ox,
      frame.oy,
      frame.w,
      frame.h,
    );
  }
  return canvas;
};
const resolveSilhouette = (config: SilhouetteConfig | true): ResolvedSilhouette => {
  if (config === true) {
    return {
      dilateRadius: ALT_MODE_SILHOUETTE_DILATE_RADIUS,
      blurRadius: ALT_MODE_SILHOUETTE_BLUR_RADIUS,
      intensity: 1,
    };
  }
  return {
    dilateRadius: config.dilateRadius,
    blurRadius: config.blurRadius,
    intensity: config.intensity ?? 1,
  };
};
const silhouetteCacheKey = (iconKey: string, config: ResolvedSilhouette): string => {
  return `${iconKey}\0silhouette\0${config.dilateRadius}\0${config.blurRadius}\0${config.intensity}`;
};
const compositeWithSilhouette = (
  iconCanvas: HTMLCanvasElement,
  config: ResolvedSilhouette,
): string | null => {
  const width = iconCanvas.width;
  const height = iconCanvas.height;
  const { dilateRadius, blurRadius, intensity } = config;
  const silhouette = bakeEntityInfoSilhouette(
    iconCanvas,
    width,
    height,
    (w, h) => createCanvas(w, h),
    dilateRadius,
    blurRadius,
  );
  if (!silhouette) return iconCanvas.toDataURL("image/png") || null;
  const pad = entityInfoSilhouettePadPx(dilateRadius, blurRadius);
  const out = createCanvas(width + 2 * pad, height + 2 * pad);
  const ctx = out.getContext("2d");
  if (!ctx) return iconCanvas.toDataURL("image/png") || null;
  ctx.globalAlpha = intensity;
  ctx.drawImage(silhouette as CanvasImageSource, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(iconCanvas, pad, pad);
  return out.toDataURL("image/png") || null;
};
const loadIcon = async (
  iconKey: string,
  silhouette: SilhouetteConfig | true | undefined,
): Promise<LoadedIcon | null> => {
  const resolved = silhouette ? resolveSilhouette(silhouette) : null;
  const cacheKey = resolved ? silhouetteCacheKey(iconKey, resolved) : iconKey;
  const cached = urlCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const db: RenderDb = await assets.loadRenderDb();
      const frameId = resolveIconFrameId(db, iconKey);
      if (frameId === undefined) return null;
      const frame = db.frames[frameId];
      if (!frame) return null;
      const atlas = (await assets.loadAtlasImage(frame.a)) as CanvasImageSource;
      const iconCanvas = cropFrameToCanvas(atlas, frame);
      if (!resolved) {
        return {
          url: iconCanvas.toDataURL("image/png") || "",
          frameW: iconCanvas.width,
          frameH: iconCanvas.height,
          pad: 0,
        };
      }
      const url = compositeWithSilhouette(iconCanvas, resolved);
      if (!url) return null;
      return {
        url,
        frameW: iconCanvas.width,
        frameH: iconCanvas.height,
        pad: entityInfoSilhouettePadPx(resolved.dilateRadius, resolved.blurRadius),
      };
    } catch {
      return null;
    }
  })();
  urlCache.set(cacheKey, promise);
  return promise;
};
const loadFirstIcon = async (
  iconKeys: string[],
  silhouette: SilhouetteConfig | true | undefined,
): Promise<LoadedIcon | null> => {
  for (const key of iconKeys) {
    const loaded = await loadIcon(key, silhouette);
    if (loaded) return loaded;
  }
  return null;
};
const iconImgStyle = (loaded: LoadedIcon, displaySize: number, pad: number): CSSProperties => {
  const scale = displaySize / Math.max(loaded.frameW, loaded.frameH);
  return {
    width: (loaded.frameW + 2 * pad) * scale,
    height: (loaded.frameH + 2 * pad) * scale,
    imageRendering: "pixelated",
  };
};
const qualityBadgeStyle = (parentSize: number, badge: LoadedIcon): CSSProperties => {
  const badgeSize = parentSize * QUALITY_BADGE_SIZE_FRACTION;
  const scale = badgeSize / Math.max(badge.frameW, badge.frameH);
  const width = badge.frameW * scale;
  const height = badge.frameH * scale;
  const centerX = parentSize / 2 + parentSize * QUALITY_BADGE_OFFSET_X_FRACTION;
  const centerY = parentSize / 2 + parentSize * QUALITY_BADGE_OFFSET_Y_FRACTION;
  return {
    position: "absolute",
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    imageRendering: "pixelated",
  };
};
export const FactorioItemIcon = ({
  iconKey,
  className,
  title,
  silhouette,
  iconSize,
  quality,
  inline,
}: {
  /** Primary key, or ordered candidates (e.g. item then entity for rails). */
  iconKey: string | string[];
  className?: string;
  title?: string;
  /**
   * Opt-in black silhouette behind the icon. Off by default.
   * Pass `true` for alt-mode defaults, or `{ dilateRadius, blurRadius, intensity? }` to tune.
   */
  silhouette?: SilhouetteConfig | true;
  /** Icon display size in px (core size when `silhouette` is set). */
  iconSize?: number;
  /** Non-normal quality tier badge (bottom-left overlay, alt-mode style). */
  quality?: string;
  /** Size to parent box for inline rich-text embedding (fills width/height). */
  inline?: boolean;
}) => {
  const [loaded, setLoaded] = useState<LoadedIcon | null>(null);
  const [qualityBadge, setQualityBadge] = useState<LoadedIcon | null>(null);
  const silhouetteKey = silhouette ? JSON.stringify(resolveSilhouette(silhouette)) : "";
  const showQuality = Boolean(quality && quality !== "normal");
  useEffect(() => {
    const keys = Array.isArray(iconKey) ? iconKey : [iconKey];
    let cancelled = false;
    void loadFirstIcon(keys, silhouette).then((result) => {
      if (!cancelled) setLoaded(result);
    });
    return () => {
      cancelled = true;
    };
  }, [iconKey, silhouetteKey, silhouette]);
  useEffect(() => {
    if (!showQuality || !quality) {
      setQualityBadge(null);
      return;
    }
    let cancelled = false;
    void loadIcon(`quality/${quality}`, undefined).then((result) => {
      if (!cancelled) setQualityBadge(result);
    });
    return () => {
      cancelled = true;
    };
  }, [quality, showQuality]);
  const pad = silhouette ? (loaded?.pad ?? 0) : 0;
  const displaySize = iconSize ?? (Math.max(loaded?.frameW ?? 0, loaded?.frameH ?? 0) || 16);
  const boxClass = inline
    ? "relative block size-full overflow-visible"
    : "relative inline-block shrink-0 align-middle overflow-visible";
  if (!loaded?.url) {
    if (inline) {
      return <span className="block size-full bg-muted/40" aria-hidden />;
    }
    return (
      <span
        className={cn("inline-block shrink-0 bg-muted/40", className)}
        style={iconSize ? { width: iconSize, height: iconSize } : undefined}
        aria-hidden
      />
    );
  }
  const imgStyle = iconSize ? iconImgStyle(loaded, displaySize, pad) : undefined;
  const mainImg = (
    <img
      src={loaded.url}
      alt=""
      title={title}
      draggable={false}
      className={cn(
        "max-w-none",
        inline ? "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : "shrink-0",
        !iconSize && "object-contain",
        className,
      )}
      style={imgStyle ?? { imageRendering: "pixelated" }}
    />
  );
  if (showQuality && iconSize && qualityBadge?.url) {
    return (
      <span
        className={boxClass}
        style={inline ? undefined : { width: displaySize, height: displaySize }}
        title={title}
      >
        {inline ? (
          mainImg
        ) : (
          <span className="absolute inset-0 flex items-center justify-center">{mainImg}</span>
        )}
        <img
          src={qualityBadge.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={qualityBadgeStyle(displaySize, qualityBadge)}
        />
      </span>
    );
  }
  if (inline) {
    return (
      <span className={boxClass} title={title}>
        {mainImg}
      </span>
    );
  }
  return mainImg;
};
