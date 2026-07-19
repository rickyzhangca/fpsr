import type { PreviewBackgroundMode } from "@/shell/viewer-preferences";
import type { RenderBackground } from "@rickyzhangca/fpsr";

export const DEFAULT_ORBIT_PLANETS = ["nauvis"] as const;
export const ORBIT_SELECT_PREFIX = "orbit:";

export const STATIC_BACKGROUND_LABELS: Record<Exclude<PreviewBackgroundMode, "orbit">, string> = {
  auto: "Auto",
  checkerboard: "Checkerboard",
  space: "Space",
  dirt: "Dirt",
  water: "Water",
  vulcanus: "Vulcanus",
  gleba: "Gleba",
  fulgora: "Fulgora",
  aquilo: "Aquilo",
};

export const TERRAIN_BACKGROUND_MODES = [
  "dirt",
  "water",
  "vulcanus",
  "gleba",
  "fulgora",
  "aquilo",
] as const satisfies ReadonlyArray<Exclude<PreviewBackgroundMode, "orbit">>;

export const isTerrainBackgroundMode = (
  value: string,
): value is (typeof TERRAIN_BACKGROUND_MODES)[number] => {
  return (TERRAIN_BACKGROUND_MODES as ReadonlyArray<string>).includes(value);
};

export const toRenderBackground = (
  showBackground: boolean,
  backgroundMode: PreviewBackgroundMode,
  orbitPlanet: string,
): RenderBackground => {
  if (!showBackground) return { type: "none" };
  switch (backgroundMode) {
    case "auto":
      return { type: "auto" };
    case "checkerboard":
      return { type: "checkerboard" };
    case "space":
      return { type: "space" };
    case "orbit":
      return { type: "space", planet: true, planetName: orbitPlanet };
    default:
      if (isTerrainBackgroundMode(backgroundMode)) {
        return { type: "terrain", name: backgroundMode };
      }
      return { type: "none" };
  }
};

const TERRAIN_SWATCH: Record<(typeof TERRAIN_BACKGROUND_MODES)[number], string> = {
  dirt: "bg-[#b98748]",
  water: "bg-[#1c5967]",
  vulcanus: "bg-[#23261e]",
  gleba: "bg-[#343730]",
  fulgora: "bg-[#704132]",
  aquilo: "bg-[#dce6f0]",
};

const PLANET_ORB_GRADIENT: Record<string, string> = {
  nauvis: "bg-[radial-gradient(circle_at_35%_35%,#6ec8ff_0%,#2f6b3a_42%,#1a3d24_70%,#0a1520_100%)]",
  vulcanus:
    "bg-[radial-gradient(circle_at_35%_35%,#ffb347_0%,#c44b16_40%,#5a1a0a_75%,#0a1520_100%)]",
  gleba: "bg-[radial-gradient(circle_at_35%_35%,#c8e06a_0%,#5a7a2e_45%,#2a3d18_75%,#0a1520_100%)]",
  fulgora:
    "bg-[radial-gradient(circle_at_35%_35%,#ffc2e0_0%,#e85a9b_42%,#7a1a4a_75%,#0a1520_100%)]",
  aquilo: "bg-[radial-gradient(circle_at_35%_35%,#e8f4ff_0%,#7eb6d9_40%,#2a4a6a_75%,#0a1520_100%)]",
};

export const formatPlanetLabel = (planet: string): string => {
  return planet
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
};

export const orbitSelectValue = (planet: string): string => `${ORBIT_SELECT_PREFIX}${planet}`;

export const parseOrbitSelectValue = (value: string): string | null => {
  return value.startsWith(ORBIT_SELECT_PREFIX) ? value.slice(ORBIT_SELECT_PREFIX.length) : null;
};

const SPACE_ICON_SHELL =
  "size-6 shrink-0 overflow-hidden rounded-sm border border-foreground/24 bg-black bg-size-[6px_6px] bg-[radial-gradient(circle,#525252_0.45px,transparent_0.55px)]";

export const SpacePreviewIcon = ({ planet }: { planet?: string }) => {
  if (!planet) {
    return <span aria-hidden className={SPACE_ICON_SHELL} />;
  }
  const orb =
    PLANET_ORB_GRADIENT[planet] ??
    "bg-[radial-gradient(circle_at_35%_35%,#c0c8d0_0%,#4a5560_45%,#1a2028_75%,#0a1520_100%)]";
  return (
    <span aria-hidden className={`relative ${SPACE_ICON_SHELL}`}>
      <span
        className={`absolute -bottom-1.5 -left-1.5 size-4 rounded-full shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--border)_80%,white)] ${orb}`}
      />
    </span>
  );
};

export const BackgroundPreviewIcon = ({
  mode,
}: {
  mode: Exclude<PreviewBackgroundMode, "orbit">;
}) => {
  if (mode === "auto") {
    return (
      <span
        aria-hidden
        className="relative size-6 shrink-0 overflow-hidden rounded-sm border border-border"
      >
        <span className="absolute inset-0 bg-size-[12px_12px] bg-[conic-gradient(var(--muted)_90deg,var(--background)_0_180deg,var(--muted)_0_270deg,var(--background)_0)] [clip-path:polygon(0_0,55%_0,45%_100%,0_100%)]" />
        <span className="absolute inset-0 bg-black bg-size-[6px_6px] bg-[radial-gradient(circle,#525252_0.45px,transparent_0.55px)] [clip-path:polygon(55%_0,100%_0,100%_100%,45%_100%)]" />
      </span>
    );
  }
  if (mode === "checkerboard") {
    return (
      <span
        aria-hidden
        className="size-6 shrink-0 rounded-sm border border-border bg-size-[12px_12px] bg-[conic-gradient(var(--muted)_90deg,var(--background)_0_180deg,var(--muted)_0_270deg,var(--background)_0)]"
      />
    );
  }
  if (mode === "space") {
    return <SpacePreviewIcon />;
  }
  if (isTerrainBackgroundMode(mode)) {
    return (
      <span
        aria-hidden
        className={`size-6 shrink-0 rounded-sm border border-border ${TERRAIN_SWATCH[mode]}`}
      />
    );
  }
  return <span aria-hidden className="size-6 shrink-0 rounded-sm border border-border bg-muted" />;
};

export const staticBackgroundOptionLabel = (mode: Exclude<PreviewBackgroundMode, "orbit">) => {
  return (
    <div className="flex items-center gap-2">
      <BackgroundPreviewIcon mode={mode} />
      {STATIC_BACKGROUND_LABELS[mode]}
    </div>
  );
};

export const orbitBackgroundOptionLabel = (planet: string) => {
  return (
    <div className="flex items-center gap-2">
      <SpacePreviewIcon planet={planet} />
      {`${formatPlanetLabel(planet)} orbit`}
    </div>
  );
};

const ORBIT_PLANET_ORDER = ["nauvis", "vulcanus", "fulgora", "gleba", "aquilo"] as const;

export const sortOrbitPlanets = (names: string[]): string[] => {
  const rank = new Map<string, number>(ORBIT_PLANET_ORDER.map((name, index) => [name, index]));
  return [...names].sort((a, b) => {
    const aRank = rank.get(a) ?? ORBIT_PLANET_ORDER.length;
    const bRank = rank.get(b) ?? ORBIT_PLANET_ORDER.length;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });
};
