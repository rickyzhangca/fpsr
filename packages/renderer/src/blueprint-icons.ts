import { signalIconKeys } from "./alt-mode.js";
import type { Icon } from "./types/blueprint.js";

/** Display size of the composited blueprint tile (matches Factorio GUI slot). */
export const BLUEPRINT_ICON_TILE_SIZE = 64;

export type BlueprintIconVariant = "blueprint" | "book";

/** Signal sizes on a 64px tile, matching Factorio inventory thumbnails. */
const VARIANT_LAYOUT: Record<
  BlueprintIconVariant,
  { singleSignalPx: number; multiSignalPx: number; gapPx: number }
> = {
  blueprint: { singleSignalPx: 48, multiSignalPx: 28, gapPx: 4 },
  book: { singleSignalPx: 24, multiSignalPx: 18, gapPx: 3 },
};

/** Vertical offset on a 64px tile by filled-icon count (negative moves up). */
const SIGNAL_Y_OFFSET_PX: Record<BlueprintIconVariant, Partial<Record<1 | 2 | 3 | 4, number>>> = {
  blueprint: {},
  book: { 1: -4, 2: -5, 3: -6, 4: -6 },
};

function packedCentersForVariant(
  variant: BlueprintIconVariant,
): Record<number, ReadonlyArray<{ x: number; y: number }>> {
  const { multiSignalPx, gapPx } = VARIANT_LAYOUT[variant];
  const gridCenter = (BLUEPRINT_ICON_TILE_SIZE - multiSignalPx * 2 - gapPx) / 2 + multiSignalPx / 2;
  const gridFar = BLUEPRINT_ICON_TILE_SIZE - gridCenter;
  const near = gridCenter / BLUEPRINT_ICON_TILE_SIZE;
  const far = gridFar / BLUEPRINT_ICON_TILE_SIZE;

  return {
    1: [{ x: 0.5, y: 0.5 }],
    2: [
      { x: near, y: 0.5 },
      { x: far, y: 0.5 },
    ],
    3: [
      { x: near, y: near },
      { x: far, y: near },
      { x: near, y: far },
    ],
    4: [
      { x: near, y: near },
      { x: far, y: near },
      { x: near, y: far },
      { x: far, y: far },
    ],
  };
}

const PACKED_CENTERS: Record<
  BlueprintIconVariant,
  Record<number, ReadonlyArray<{ x: number; y: number }>>
> = {
  blueprint: packedCentersForVariant("blueprint"),
  book: packedCentersForVariant("book"),
};

export function filledBlueprintIcons(icons: Icon[] | undefined): Icon[] {
  if (!icons) return [];
  return icons
    .filter((icon) => icon.index >= 1 && icon.index <= 4 && icon.signal?.name)
    .slice()
    .sort((a, b) => a.index - b.index);
}

/** Signal size in px for a given tile size and filled-icon count. */
export function blueprintIconSignalSizePx(
  tileSize: number,
  count: number,
  variant: BlueprintIconVariant = "blueprint",
): number {
  const n = Math.min(4, Math.max(1, count));
  const { singleSignalPx, multiSignalPx } = VARIANT_LAYOUT[variant];
  const base = n === 1 ? singleSignalPx : multiSignalPx;
  return (base / BLUEPRINT_ICON_TILE_SIZE) * tileSize;
}

/** Signal scale as a fraction of the tile. */
export function blueprintIconSignalScale(
  count: number,
  variant: BlueprintIconVariant = "blueprint",
): number {
  return (
    blueprintIconSignalSizePx(BLUEPRINT_ICON_TILE_SIZE, count, variant) / BLUEPRINT_ICON_TILE_SIZE
  );
}

/** Vertical offset in px for signal overlays (negative moves up). */
export function blueprintIconSignalYOffsetPx(
  tileSize: number,
  count: number,
  variant: BlueprintIconVariant = "blueprint",
): number {
  const n = Math.min(4, Math.max(1, count)) as 1 | 2 | 3 | 4;
  const base = SIGNAL_Y_OFFSET_PX[variant][n] ?? 0;
  return (base / BLUEPRINT_ICON_TILE_SIZE) * tileSize;
}

/** Normalized center for a signal on the blueprint tile (rank is 0-based in sorted order). */
export function blueprintIconSignalCenter(
  count: number,
  rank: number,
  variant: BlueprintIconVariant = "blueprint",
): { x: number; y: number } {
  const packed = PACKED_CENTERS[variant][Math.min(4, Math.max(1, count))];
  return packed?.[rank] ?? { x: 0.5, y: 0.5 };
}

function resolveVariant(
  variant: BlueprintIconVariant | undefined,
  backgroundKey: string,
): BlueprintIconVariant {
  if (variant) return variant;
  return backgroundKey === "item/blueprint-book" ? "book" : "blueprint";
}

export interface BlueprintIconSignalPlan {
  icon: Icon;
  iconKeys: string[];
  left: number;
  top: number;
  size: number;
}

export interface BlueprintIconPlan {
  variant: BlueprintIconVariant;
  backgroundKey: string;
  tileSize: number;
  signals: BlueprintIconSignalPlan[];
}

export interface PlanBlueprintIconsOptions {
  variant?: BlueprintIconVariant;
  /** Render-db key for the paper background. */
  backgroundKey?: string;
  /** Outer tile size in px. */
  tileSize?: number;
}

/**
 * Plans blueprint preview icon layout for inventory thumbnails — background paper
 * plus up to four signal overlays, matching Factorio GUI slot sizes and packing.
 */
export function planBlueprintIcons(
  icons: Icon[] | undefined,
  opts: PlanBlueprintIconsOptions = {},
): BlueprintIconPlan {
  const backgroundKey = opts.backgroundKey ?? "item/blueprint";
  const tileSize = opts.tileSize ?? BLUEPRINT_ICON_TILE_SIZE;
  const variant = resolveVariant(opts.variant, backgroundKey);
  const filled = filledBlueprintIcons(icons);
  const count = filled.length;
  const signalSize = blueprintIconSignalSizePx(tileSize, count, variant);
  const signalYOffset = blueprintIconSignalYOffsetPx(tileSize, count, variant);

  const signals: BlueprintIconSignalPlan[] = filled.map((icon, rank) => {
    const { signal } = icon;
    const { x, y } = blueprintIconSignalCenter(count, rank, variant);
    return {
      icon,
      iconKeys: signalIconKeys(signal),
      left: x * tileSize - signalSize / 2,
      top: y * tileSize - signalSize / 2 + signalYOffset,
      size: signalSize,
    };
  });

  return { variant, backgroundKey, tileSize, signals };
}
