import { atomWithStorage } from "jotai/utils";

export type ViewerTab = "preview" | "process" | "performance";

export interface PreviewPreferences {
  limitTo4k: boolean;
  exportFormat: "webp" | "png";
  altMode: boolean;
  showCoords: boolean;
  showCheckerboard: boolean;
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

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};
const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
};

export const isViewerTab = (value: unknown): value is ViewerTab => {
  return value === "preview" || value === "process" || value === "performance";
};

const isPreviewPreferences = (value: unknown): value is PreviewPreferences => {
  return (
    isRecord(value) &&
    isBoolean(value.limitTo4k) &&
    (value.exportFormat === "webp" || value.exportFormat === "png") &&
    isBoolean(value.altMode) &&
    isBoolean(value.showCoords) &&
    isBoolean(value.showCheckerboard)
  );
};

const isPanelLayout = (value: unknown): value is Record<string, number> => {
  const panelIds = ["decoded", "draw", "checks"];
  return (
    isRecord(value) &&
    Object.keys(value).length === panelIds.length &&
    panelIds.every((panelId) => isFiniteNumber(value[panelId]) && value[panelId] >= 0)
  );
};

const isProcessPreferences = (value: unknown): value is ProcessPreferences => {
  return (
    isRecord(value) &&
    isBoolean(value.organizeDrawCommands) &&
    (value.panelLayout === null || isPanelLayout(value.panelLayout))
  );
};

const isSidebarExpansion = (value: unknown): value is SidebarExpansion => {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([section, expandedItems]) =>
      (section === "demos" || section === "tests" || section === "custom") &&
      isStringArray(expandedItems),
  );
};

const createValidatedStorage = <Value>(validate: (value: unknown) => value is Value) => {
  const read = (raw: string | null, initialValue: Value): Value => {
    if (raw === null) return initialValue;
    try {
      const parsed: unknown = JSON.parse(raw);
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
  showCheckerboard: true,
};

export const DEFAULT_PROCESS_PREFERENCES: ProcessPreferences = {
  organizeDrawCommands: true,
  panelLayout: null,
};

const storageOptions = { getOnInit: true } as const;

export const summaryExpandedAtom = atomWithStorage(
  VIEWER_PREFERENCE_KEYS.summaryExpanded,
  true,
  createValidatedStorage(isBoolean),
  storageOptions,
);

export const activeTabAtom = atomWithStorage(
  VIEWER_PREFERENCE_KEYS.activeTab,
  "preview" as ViewerTab,
  createValidatedStorage(isViewerTab),
  storageOptions,
);

export const previewPreferencesAtom = atomWithStorage(
  VIEWER_PREFERENCE_KEYS.preview,
  DEFAULT_PREVIEW_PREFERENCES,
  createValidatedStorage(isPreviewPreferences),
  storageOptions,
);

export const processPreferencesAtom = atomWithStorage(
  VIEWER_PREFERENCE_KEYS.process,
  DEFAULT_PROCESS_PREFERENCES,
  createValidatedStorage(isProcessPreferences),
  storageOptions,
);

export const sidebarExpansionAtom = atomWithStorage(
  VIEWER_PREFERENCE_KEYS.sidebarExpansion,
  {} as SidebarExpansion,
  createValidatedStorage(isSidebarExpansion),
  storageOptions,
);
