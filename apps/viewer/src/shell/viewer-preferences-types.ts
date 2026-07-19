import { canUseLocalAssets, defaultUseCdnAssets } from "./asset-config";

export type ViewerTab = "preview" | "process" | "performance";

export type PreviewBackgroundMode =
  | "auto"
  | "checkerboard"
  | "space"
  | "orbit"
  | "dirt"
  | "water"
  | "vulcanus"
  | "gleba"
  | "fulgora"
  | "aquilo";

export interface PreviewPreferences {
  limitTo4k: boolean;
  exportFormat: "webp" | "png";
  altMode: boolean;
  showCoords: boolean;
  showBackground: boolean;
  /** When true, fetch render assets from the CDN instead of local `/assets`. */
  useCdnAssets: boolean;
  backgroundMode: PreviewBackgroundMode;
  /** Factorio planet prototype name used when `backgroundMode` is `"orbit"`. */
  orbitPlanet: string;
}

export interface ProcessPreferences {
  organizeDrawCommands: boolean;
  panelLayout: Record<string, number> | null;
}

export type SidebarSectionId = "demos" | "tests" | "custom";
export type SidebarExpansion = Partial<Record<SidebarSectionId, string[]>>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

export const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
};

export const isViewerTab = (value: unknown): value is ViewerTab => {
  return value === "preview" || value === "process" || value === "performance";
};

export const isPreviewBackgroundMode = (value: unknown): value is PreviewBackgroundMode => {
  return (
    value === "auto" ||
    value === "checkerboard" ||
    value === "space" ||
    value === "orbit" ||
    value === "dirt" ||
    value === "water" ||
    value === "vulcanus" ||
    value === "gleba" ||
    value === "fulgora" ||
    value === "aquilo"
  );
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

export const normalizePreviewPreferences = (value: unknown): PreviewPreferences | null => {
  if (!isRecord(value)) return null;
  if (
    !isBoolean(value.limitTo4k) ||
    (value.exportFormat !== "webp" && value.exportFormat !== "png") ||
    !isBoolean(value.altMode) ||
    !isBoolean(value.showCoords)
  ) {
    return null;
  }
  let backgroundMode: PreviewBackgroundMode;
  let showBackground: boolean;
  let orbitPlanet = isNonEmptyString(value.orbitPlanet) ? value.orbitPlanet : "nauvis";
  if (isPreviewBackgroundMode(value.backgroundMode)) {
    backgroundMode = value.backgroundMode;
    showBackground = isBoolean(value.showBackground) ? value.showBackground : true;
  } else if (value.backgroundMode === "nauvis-orbit") {
    // Migrate single-planet orbit mode into orbit + planet name.
    backgroundMode = "orbit";
    orbitPlanet = "nauvis";
    showBackground = isBoolean(value.showBackground) ? value.showBackground : true;
  } else if (value.backgroundMode === "transparent") {
    // Migrate transparent-from-select into switch-off + retained select value.
    backgroundMode = "checkerboard";
    showBackground = false;
  } else if (isBoolean(value.showCheckerboard)) {
    // Migrate pre-space preference shape.
    backgroundMode = "checkerboard";
    showBackground = value.showCheckerboard;
  } else {
    return null;
  }
  return {
    limitTo4k: value.limitTo4k,
    exportFormat: value.exportFormat,
    altMode: value.altMode,
    showCoords: value.showCoords,
    showBackground,
    // Missing field (older prefs) defaults to local on dev, CDN when deployed.
    useCdnAssets: canUseLocalAssets()
      ? isBoolean(value.useCdnAssets)
        ? value.useCdnAssets
        : false
      : true,
    backgroundMode,
    orbitPlanet,
  };
};

export const isPreviewPreferences = (value: unknown): value is PreviewPreferences => {
  return normalizePreviewPreferences(value) !== null;
};

const isPanelLayout = (value: unknown): value is Record<string, number> => {
  const panelIds = ["decoded", "draw", "checks"];
  return (
    isRecord(value) &&
    Object.keys(value).length === panelIds.length &&
    panelIds.every((panelId) => isFiniteNumber(value[panelId]) && value[panelId] >= 0)
  );
};

export const isProcessPreferences = (value: unknown): value is ProcessPreferences => {
  return (
    isRecord(value) &&
    isBoolean(value.organizeDrawCommands) &&
    (value.panelLayout === null || isPanelLayout(value.panelLayout))
  );
};

export const isSidebarExpansion = (value: unknown): value is SidebarExpansion => {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([section, expandedItems]) =>
      (section === "demos" || section === "tests" || section === "custom") &&
      isStringArray(expandedItems),
  );
};

export const VIEWER_PREFERENCE_KEYS = {
  summaryExpanded: "fpsr-viewer:summary-expanded:v1",
  activeTab: "fpsr-viewer:active-tab:v1",
  preview: "fpsr-viewer:preview-preferences:v1",
  process: "fpsr-viewer:process-preferences:v1",
  sidebarExpansion: "fpsr-viewer:sidebar-expansion:v1",
} as const;

export const DEFAULT_PREVIEW_PREFERENCES: PreviewPreferences = {
  limitTo4k: true,
  exportFormat: "webp",
  altMode: true,
  showCoords: false,
  showBackground: true,
  useCdnAssets: defaultUseCdnAssets(),
  backgroundMode: "auto",
  orbitPlanet: "nauvis",
};

export const DEFAULT_PROCESS_PREFERENCES: ProcessPreferences = {
  organizeDrawCommands: true,
  panelLayout: null,
};

export const createValidatedStorage = <Value>(
  validate: (value: unknown) => value is Value,
  normalize?: (value: unknown) => Value | null,
) => {
  const read = (raw: string | null, initialValue: Value): Value => {
    if (raw === null) return initialValue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (normalize) return normalize(parsed) ?? initialValue;
      return validate(parsed) ? parsed : initialValue;
    } catch {
      return initialValue;
    }
  };

  return {
    getItem(key: string, initialValue: Value): Value {
      try {
        return read(window.localStorage.getItem(key), initialValue);
      } catch {
        return initialValue;
      }
    },
    setItem(key: string, value: Value): void {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Preferences are best-effort; the in-memory atom remains usable.
      }
    },
    removeItem(key: string): void {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Preferences are best-effort; the in-memory atom remains usable.
      }
    },
    subscribe(key: string, callback: (value: Value) => void, initialValue: Value) {
      const handler = (event: StorageEvent) => {
        if (event.storageArea === window.localStorage && event.key === key) {
          callback(read(event.newValue, initialValue));
        }
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
};
