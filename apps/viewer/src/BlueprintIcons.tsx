import { planBlueprintIcons, type BlueprintIconVariant, type Icon } from "fpsr";
import { FactorioItemIcon } from "./FactorioItemIcon";

export type { BlueprintIconVariant };

/**
 * Renders blueprint preview icons composited onto the blue blueprint item tile,
 * matching Factorio's inventory thumbnail sizes and count-based layout.
 */
export function BlueprintIcons({
  icons,
  size,
  backgroundKey,
  variant,
}: {
  icons?: Icon[];
  /** Outer tile size in px. */
  size?: number;
  /** Render-db key for the paper background. */
  backgroundKey?: string;
  /** Blueprint paper vs book cover sizing. Inferred from backgroundKey when omitted. */
  variant?: BlueprintIconVariant;
}) {
  const plan = planBlueprintIcons(icons, { variant, backgroundKey, tileSize: size });

  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: plan.tileSize, height: plan.tileSize }}
      aria-label="Blueprint icons"
    >
      <FactorioItemIcon iconKey={plan.backgroundKey} iconSize={plan.tileSize} title="blueprint" />
      {plan.signals.map(({ icon, iconKeys, left, top, size: signalSize }) => {
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
      })}
    </div>
  );
}
