import {
  blueprintIconSignalYOffsetPx,
  planBlueprintIcons,
  type BlueprintIconVariant,
  type Icon,
} from "fpsr";
import { FactorioItemIcon } from "./factorio-item-icon";
export type { BlueprintIconVariant };

/** Nested composite (e.g. planner paper + icons) drawn in a single book cover slot. */
export type BlueprintNestedCover = {
  backgroundKey: string;
  icons?: Icon[];
};

export const BlueprintIcons = ({
  icons,
  size,
  backgroundKey,
  variant,
  nestedCover,
}: {
  icons?: Icon[];
  /** Outer tile size in px. */
  size?: number;
  /** Render-db key for the paper background. */
  backgroundKey?: string;
  /** Blueprint paper vs book cover sizing. Inferred from backgroundKey when omitted. */
  variant?: BlueprintIconVariant;
  /**
   * When set, draw this composite as the single icon on the outer paper
   * (book cover hosting a planner thumbnail). Ignores flat `icons` overlays.
   */
  nestedCover?: BlueprintNestedCover;
}) => {
  const plan = planBlueprintIcons(nestedCover ? undefined : icons, {
    variant,
    backgroundKey,
    tileSize: size,
  });
  // Nested planner thumbnails sit between book (~24/64) and blueprint (~48/64)
  // single-icon scales so the composite reads clearly without dominating the cover.
  const nestedSize = nestedCover ? (40 / 64) * plan.tileSize : undefined;
  const nestedYOffset = nestedCover
    ? blueprintIconSignalYOffsetPx(plan.tileSize, 1, plan.variant)
    : 0;
  const nestedLeft = nestedSize != null ? (plan.tileSize - nestedSize) / 2 : 0;
  const nestedTop = nestedSize != null ? (plan.tileSize - nestedSize) / 2 + nestedYOffset : 0;
  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: plan.tileSize, height: plan.tileSize }}
      aria-label="Blueprint icons"
    >
      <FactorioItemIcon iconKey={plan.backgroundKey} iconSize={plan.tileSize} title="blueprint" />
      {nestedCover && nestedSize != null ? (
        <span
          className="pointer-events-none absolute"
          style={{
            left: nestedLeft,
            top: nestedTop,
            width: nestedSize,
            height: nestedSize,
            filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 0.55))",
          }}
        >
          <BlueprintIcons
            icons={nestedCover.icons}
            backgroundKey={nestedCover.backgroundKey}
            size={nestedSize}
            variant="blueprint"
          />
        </span>
      ) : (
        plan.signals.map(({ icon, iconKeys, left, top, size: signalSize }) => {
          const { signal } = icon;
          const type = signal.type ?? "item";
          return (
            <span
              key={`${icon.index}-${signal.name}`}
              className="pointer-events-none absolute"
              style={{
                left,
                top,
                width: signalSize,
                height: signalSize,
                filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 0.55))",
              }}
            >
              <FactorioItemIcon
                iconKey={iconKeys}
                quality={signal.quality}
                iconSize={signalSize}
                title={`${type}/${signal.name}`}
              />
            </span>
          );
        })
      )}
    </div>
  );
};
