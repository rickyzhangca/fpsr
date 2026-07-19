import type { SidebarSelectableKind } from "@/sidebar/sidebar-tree";

const LAST_VIEW_KEY = "fpsr-viewer:last-view:v1";
const LEGACY_LAST_VIEW_KEY = "fpsr-viewer:last-view";

export interface LastView {
  sourceId: string;
  path: number[] | null;
  kind: SidebarSelectableKind;
}

export const readLastView = (): LastView | null => {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY) ?? localStorage.getItem(LEGACY_LAST_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastView>;
    if (typeof parsed.sourceId !== "string") return null;
    const path =
      Array.isArray(parsed.path) &&
      parsed.path.every((index) => Number.isInteger(index) && index >= 0)
        ? parsed.path
        : null;
    const kind: SidebarSelectableKind =
      parsed.kind === "book"
        ? "book"
        : parsed.kind === "upgrade_planner"
          ? "upgrade_planner"
          : "blueprint";
    return { sourceId: parsed.sourceId, path, kind };
  } catch {
    return null;
  }
};

export const writeLastView = (view: LastView): void => {
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
  } catch {
    // Last-view restoration is best-effort when storage is unavailable.
  }
};
