/**
 * Discriminated background mode for {@link RenderOptions}.
 *
 * Replaces the former combinatorial boolean flags (`showCheckerboard`,
 * `showSpace`, `showBackgroundAuto`, `terrainBackground`, …).
 */
export type RenderBackground =
  | { type: "none" }
  | { type: "solid"; color: [number, number, number, number] }
  | { type: "checkerboard" }
  | {
      type: "space";
      /** Draw the render-db space-platform planet decoration. */
      planet?: boolean;
      /** Factorio planet prototype name when `planet` is true. */
      planetName?: string;
    }
  | { type: "terrain"; name: string }
  | {
      /**
       * Pick checkerboard vs space from the blueprint (space platform → space
       * starfield without planet).
       */
      type: "auto";
    };

export class UnknownTerrainBackgroundError extends Error {
  readonly name = "UnknownTerrainBackgroundError";
  readonly terrainName: string;

  constructor(terrainName: string) {
    super(`Unknown terrain background "${terrainName}"`);
    this.terrainName = terrainName;
  }
}

export class AssetDensityMismatchError extends Error {
  readonly name = "AssetDensityMismatchError";
  readonly tier: "1x" | "2x";
  readonly expectedDensity: 1 | 2;
  readonly actualDensity: 1 | 2 | undefined;

  constructor(tier: "1x" | "2x", expectedDensity: 1 | 2, actualDensity: 1 | 2 | undefined) {
    super(
      `Render DB assetDensity ${actualDensity ?? "undefined"} does not match asset tier ${tier} (expected ${expectedDensity})`,
    );
    this.tier = tier;
    this.expectedDensity = expectedDensity;
    this.actualDensity = actualDensity;
  }
}

/** Resolved concrete background flags used by the Canvas2D backend. */
export interface ResolvedBackground {
  solid: [number, number, number, number] | null;
  showCheckerboard: boolean;
  showSpace: boolean;
  showSpacePlanet: boolean;
  spacePlanet?: string;
  terrainName?: string;
}

export function resolveBackground(
  prefersPlatformGraphics: boolean,
  background?: RenderBackground,
): ResolvedBackground {
  const mode = background ?? { type: "none" };
  switch (mode.type) {
    case "none":
      return {
        solid: null,
        showCheckerboard: false,
        showSpace: false,
        showSpacePlanet: false,
      };
    case "solid":
      return {
        solid: mode.color,
        showCheckerboard: false,
        showSpace: false,
        showSpacePlanet: false,
      };
    case "checkerboard":
      return {
        solid: null,
        showCheckerboard: true,
        showSpace: false,
        showSpacePlanet: false,
      };
    case "space":
      return {
        solid: null,
        showCheckerboard: false,
        showSpace: true,
        showSpacePlanet: mode.planet === true,
        spacePlanet: mode.planetName,
      };
    case "terrain":
      return {
        solid: null,
        showCheckerboard: false,
        showSpace: false,
        showSpacePlanet: false,
        terrainName: mode.name,
      };
    case "auto": {
      const useSpace = prefersPlatformGraphics;
      return {
        solid: null,
        showCheckerboard: !useSpace,
        showSpace: useSpace,
        showSpacePlanet: false,
      };
    }
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
