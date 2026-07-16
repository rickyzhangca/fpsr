import type { BookTreeItemKind, Icon } from "fpsr";
import {
  docToSidebarItems,
  selectionId,
  type SidebarSource,
  type SidebarSourceId,
} from "./sidebar-tree";

export interface SidebarSelectionInfo {
  label: string;
  kind: BookTreeItemKind;
  icons?: Icon[];
}

const FALLBACK: SidebarSelectionInfo = {
  label: "Select blueprint",
  kind: "blueprint",
};

/**
 * Resolve the display label/icon for the currently selected sidebar item.
 * Falls back to the source catalog label, then "Select blueprint".
 */
export function resolveSidebarSelection(
  sources: SidebarSource[],
  selectedSourceId: SidebarSourceId,
  selectedPath: number[] | null,
): SidebarSelectionInfo {
  const source = sources.find((s) => s.id === selectedSourceId);
  if (!source) return FALLBACK;

  const items = docToSidebarItems(source);
  const id = selectionId(selectedSourceId, selectedPath);
  const item = items[id];
  if (item) {
    return { label: item.label, kind: item.kind, icons: item.icons };
  }

  return { label: source.label || FALLBACK.label, kind: FALLBACK.kind };
}
