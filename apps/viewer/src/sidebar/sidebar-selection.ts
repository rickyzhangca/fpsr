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
  iconBackgroundKey?: string;
}
const FALLBACK: SidebarSelectionInfo = {
  label: "Select blueprint",
  kind: "blueprint",
};
export const resolveSidebarSelection = (
  sources: SidebarSource[],
  selectedSourceId: SidebarSourceId,
  selectedPath: number[] | null,
): SidebarSelectionInfo => {
  const source = sources.find((s) => s.id === selectedSourceId);
  if (!source) return FALLBACK;
  const items = docToSidebarItems(source);
  const id = selectionId(selectedSourceId, selectedPath);
  const item = items[id];
  if (item) {
    return {
      label: item.label,
      kind: item.kind,
      icons: item.icons,
      iconBackgroundKey: item.iconBackgroundKey,
    };
  }
  return { label: source.label || FALLBACK.label, kind: FALLBACK.kind };
};
