import { atomWithStorage } from "jotai/utils";
import {
  createValidatedStorage,
  DEFAULT_PREVIEW_PREFERENCES,
  DEFAULT_PROCESS_PREFERENCES,
  isBoolean,
  isPreviewPreferences,
  isProcessPreferences,
  isSidebarExpansion,
  isViewerTab,
  normalizePreviewPreferences,
  type SidebarExpansion,
  type ViewerTab,
  VIEWER_PREFERENCE_KEYS,
} from "./viewer-preferences-types";

export type {
  PreviewBackgroundMode,
  PreviewPreferences,
  ProcessPreferences,
  SidebarExpansion,
  SidebarSectionId,
  ViewerTab,
} from "./viewer-preferences-types";

export {
  DEFAULT_PREVIEW_PREFERENCES,
  DEFAULT_PROCESS_PREFERENCES,
  isPreviewBackgroundMode,
  isViewerTab,
  VIEWER_PREFERENCE_KEYS,
} from "./viewer-preferences-types";

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
  createValidatedStorage(isPreviewPreferences, normalizePreviewPreferences),
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
