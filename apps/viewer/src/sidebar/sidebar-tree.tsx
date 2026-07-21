import { BlueprintIcons } from "@/blueprint/blueprint-icons";
import { FactorioRichText } from "@/blueprint/factorio-rich-text";
import { Progress } from "@/components/ui/progress";
import {
  Tree,
  TreeExpandIcon,
  TreeItem,
  TreeItemButton,
  TreeItemIconSlot,
} from "@/components/ui/tree";
import { sidebarExpansionAtom, type SidebarSectionId } from "@/shell/viewer-preferences";
import { hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import {
  buildBookTree,
  deconstructionPlannerIcons,
  upgradePlannerIcons,
  type BlueprintDocument,
  type BookTreeItemKind,
  type Icon,
} from "@rickyzhangca/fpsr";
import { useAtom } from "jotai";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
const INDENT_PX = 12;
const ROOT_ID = "root";
const sameItemIds = (left: string[], right: string[]): boolean => {
  return left.length === right.length && left.every((itemId, index) => itemId === right[index]);
};
const KIND_ICON_KEY: Record<BookTreeItemKind, string> = {
  book: "item/blueprint-book",
  blueprint: "item/blueprint",
  upgrade_planner: "item/upgrade-planner",
  deconstruction_planner: "item/deconstruction-planner",
};
export type SidebarSourceId = string;
export interface SidebarTreeItem {
  id: string;
  sourceId: SidebarSourceId;
  path: number[];
  label: string;
  kind: BookTreeItemKind;
  icons?: Icon[];
  /** Override paper for book covers whose first leaf is a planner. */
  iconBackgroundKey?: string;
  children: string[];
}
const EMPTY_ITEM: SidebarTreeItem = {
  id: "",
  sourceId: "",
  path: [],
  label: "",
  kind: "blueprint",
  children: [],
};
export interface SidebarSource {
  id: SidebarSourceId;
  label: string;
  doc: BlueprintDocument;
  /** Original Factorio blueprint string when available (top-level source). */
  raw?: string;
}
export interface SidebarRenderProgress {
  sourceId: SidebarSourceId;
  path: number[] | null;
  value: number;
  label: string;
  durationMs?: number;
}
export const selectionId = (sourceId: SidebarSourceId, path: number[] | null): string => {
  if (!path || path.length === 0) return sourceId;
  return `${sourceId}:${path.join(".")}`;
};
const ancestorIdsForSelection = (sourceId: SidebarSourceId, path: number[] | null): string[] => {
  const ids = [ROOT_ID, sourceId];
  if (!path || path.length === 0) return ids;
  for (let i = 1; i < path.length; i++) {
    ids.push(`${sourceId}:${path.slice(0, i).join(".")}`);
  }
  return ids;
};
export const docToSidebarItems = (source: SidebarSource): Record<string, SidebarTreeItem> => {
  const book = buildBookTree(source.doc);
  if (book) {
    const items: Record<string, SidebarTreeItem> = {};
    for (const [id, item] of Object.entries(book.items)) {
      if (id === book.rootId) {
        items[source.id] = {
          id: source.id,
          sourceId: source.id,
          path: [],
          label: item.label,
          kind: "book",
          icons: item.icons,
          iconBackgroundKey: item.iconBackgroundKey,
          children: item.children.map((c) => `${source.id}:${c}`),
        };
      } else {
        items[`${source.id}:${id}`] = {
          id: `${source.id}:${id}`,
          sourceId: source.id,
          path: item.path,
          label: item.label,
          kind: item.kind,
          icons: item.icons,
          iconBackgroundKey: item.iconBackgroundKey,
          children: item.children.map((c) => `${source.id}:${c}`),
        };
      }
    }
    return items;
  }
  if (source.doc.blueprint) {
    return {
      [source.id]: {
        id: source.id,
        sourceId: source.id,
        path: [],
        label: source.doc.blueprint.label ?? "",
        kind: "blueprint",
        icons: source.doc.blueprint.icons,
        children: [],
      },
    };
  }
  if (source.doc.upgrade_planner) {
    const planner = source.doc.upgrade_planner;
    const label =
      typeof planner.label === "string" && planner.label.length > 0 ? planner.label : source.label;
    const icons = upgradePlannerIcons(planner);
    return {
      [source.id]: {
        id: source.id,
        sourceId: source.id,
        path: [],
        label,
        kind: "upgrade_planner",
        icons: icons.length > 0 ? icons : undefined,
        children: [],
      },
    };
  }
  if (source.doc.deconstruction_planner) {
    const planner = source.doc.deconstruction_planner;
    const label =
      typeof planner.label === "string" && planner.label.length > 0 ? planner.label : source.label;
    const icons = deconstructionPlannerIcons(planner);
    return {
      [source.id]: {
        id: source.id,
        sourceId: source.id,
        path: [],
        label,
        kind: "deconstruction_planner",
        icons: icons.length > 0 ? icons : undefined,
        children: [],
      },
    };
  }
  return {
    [source.id]: {
      id: source.id,
      sourceId: source.id,
      path: [],
      label: source.label,
      kind: "blueprint",
      children: [],
    },
  };
};
const buildSidebarItems = (sources: SidebarSource[]): Record<string, SidebarTreeItem> => {
  const items: Record<string, SidebarTreeItem> = {};
  const rootChildren: string[] = [];
  for (const source of sources) {
    Object.assign(items, docToSidebarItems(source));
    rootChildren.push(source.id);
  }
  items[ROOT_ID] = {
    id: ROOT_ID,
    sourceId: ROOT_ID,
    path: [],
    label: "Blueprints",
    kind: "book",
    children: rootChildren,
  };
  return items;
};
export const TreeItemKindIcon = ({
  kind,
  icons,
  iconBackgroundKey,
}: {
  kind: BookTreeItemKind;
  icons?: Icon[];
  iconBackgroundKey?: string;
}) => {
  const nestedCover =
    kind === "book" && iconBackgroundKey ? { backgroundKey: iconBackgroundKey, icons } : undefined;
  return (
    <BlueprintIcons
      icons={nestedCover ? undefined : icons}
      size={36}
      backgroundKey={KIND_ICON_KEY[kind]}
      nestedCover={nestedCover}
    />
  );
};
const formatRenderDuration = (durationMs: number): string => {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};
export type SidebarSelectableKind =
  | "book"
  | "blueprint"
  | "upgrade_planner"
  | "deconstruction_planner";
export const SidebarTree = ({
  sectionId,
  sources,
  selectedSourceId,
  selectedPath,
  selectedKind,
  renderProgress,
  onSelect,
}: {
  sectionId: SidebarSectionId;
  sources: SidebarSource[];
  selectedSourceId: SidebarSourceId;
  selectedPath: number[] | null;
  selectedKind?: SidebarSelectableKind;
  renderProgress?: SidebarRenderProgress | null;
  onSelect: (sourceId: SidebarSourceId, path: number[], kind: SidebarSelectableKind) => void;
}) => {
  const items = useMemo(() => buildSidebarItems(sources), [sources]);
  const selectedItemId = selectionId(selectedSourceId, selectedPath);
  const progressItemId = renderProgress
    ? selectionId(renderProgress.sourceId, renderProgress.path)
    : null;
  const [expandedItemsBySection, setExpandedItemsBySection] = useAtom(sidebarExpansionAtom);
  const persistedExpandedItems = expandedItemsBySection[sectionId];
  const applyingPersistedExpansionRef = useRef(false);
  const [expandedItems, setExpandedItems] = useState<string[]>(
    () => persistedExpandedItems ?? ancestorIdsForSelection(selectedSourceId, selectedPath),
  );
  const expandedItemsRef = useRef(expandedItems);
  expandedItemsRef.current = expandedItems;
  useEffect(() => {
    if (!persistedExpandedItems) return;
    if (sameItemIds(expandedItemsRef.current, persistedExpandedItems)) return;
    applyingPersistedExpansionRef.current = true;
    setExpandedItems(persistedExpandedItems);
  }, [persistedExpandedItems]);
  useEffect(() => {
    if (applyingPersistedExpansionRef.current) {
      applyingPersistedExpansionRef.current = false;
      return;
    }
    setExpandedItemsBySection((previous) => {
      const current = previous[sectionId];
      if (current && sameItemIds(current, expandedItems)) return previous;
      return { ...previous, [sectionId]: expandedItems };
    });
  }, [expandedItems, sectionId, setExpandedItemsBySection]);
  useEffect(() => {
    setExpandedItems((prev) => {
      const next = new Set(prev.filter((id) => id in items));
      for (const id of ancestorIdsForSelection(selectedSourceId, selectedPath)) {
        if (id in items) next.add(id);
      }
      if (selectedKind === "book" && items[selectedItemId]?.kind === "book") {
        next.add(selectedItemId);
      }
      next.add(ROOT_ID);
      return [...next];
    });
  }, [selectedSourceId, selectedPath, selectedKind, selectedItemId, items]);
  // Drop stale expansions before the tree reads them (e.g. after Delete all).
  const safeExpandedItems = useMemo(
    () => expandedItems.filter((id) => id in items),
    [expandedItems, items],
  );
  const tree = useTree<SidebarTreeItem>({
    rootItemId: ROOT_ID,
    indent: INDENT_PX,
    state: {
      selectedItems: items[selectedItemId] ? [selectedItemId] : [],
      expandedItems: safeExpandedItems,
    },
    setExpandedItems,
    setSelectedItems: (updater) => {
      const next =
        typeof updater === "function"
          ? updater(items[selectedItemId] ? [selectedItemId] : [])
          : updater;
      const id = next[0];
      if (!id) return;
      const data = items[id];
      if (
        data?.kind === "book" ||
        data?.kind === "blueprint" ||
        data?.kind === "upgrade_planner" ||
        data?.kind === "deconstruction_planner"
      ) {
        if (data.kind === "book") {
          setExpandedItems((prev) => (prev.includes(id) ? prev : [...prev, id]));
        }
        onSelect(data.sourceId, data.path, data.kind);
      }
    },
    getItemName: (item) => item.getItemData().label,
    isItemFolder: (item) => item.getItemData().kind === "book",
    dataLoader: {
      // Never return undefined — headless-tree may still ask for deleted IDs
      // until rebuildTree runs after sources change.
      getItem: (itemId) => items[itemId] ?? { ...EMPTY_ITEM, id: itemId },
      getChildren: (itemId) => items[itemId]?.children ?? [],
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const containerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    treeRef.current.rebuildTree();
  }, [items]);
  useLayoutEffect(() => {
    if (!items[selectedItemId]) return;
    const nodes = containerRef.current?.querySelectorAll<HTMLElement>("[data-sidebar-item-id]");
    if (!nodes) return;
    for (const node of nodes) {
      if (node.getAttribute("data-sidebar-item-id") === selectedItemId) {
        node.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
    }
  }, [selectedItemId, items, safeExpandedItems]);
  return (
    <div ref={containerRef}>
      <Tree {...tree.getContainerProps("Blueprints")} className="w-max min-w-full">
        {tree.getItems().map((item) => {
          const id = item.getId();
          if (id === ROOT_ID) return null;
          const data = items[id];
          if (!data) return null;
          const isFolder = item.isFolder();
          const progress = id === progressItemId ? renderProgress : null;
          const renderedDuration =
            progress?.durationMs == null ? null : formatRenderDuration(progress.durationMs);
          return (
            <TreeItem key={id} className="w-max min-w-full">
              <TreeItemButton
                {...item.getProps()}
                indent={item.getItemMeta().level * INDENT_PX}
                data-selected={item.isSelected() || undefined}
                data-focused={item.isFocused() || undefined}
                data-sidebar-item-id={id}
                className="w-max min-w-full scroll-my-12"
              >
                <TreeItemIconSlot>
                  {isFolder ? (
                    <TreeExpandIcon expanded={item.isExpanded()} />
                  ) : (
                    <span className="size-3.5" />
                  )}
                </TreeItemIconSlot>
                <TreeItemIconSlot className="size-9">
                  <TreeItemKindIcon
                    kind={data.kind}
                    icons={data.icons}
                    iconBackgroundKey={data.iconBackgroundKey}
                  />
                </TreeItemIconSlot>
                <span className="flex shrink-0 flex-col gap-0.5 pl-1.5">
                  <span className="whitespace-nowrap">
                    <FactorioRichText
                      text={item.getItemName()}
                      fallback={data.kind === "book" ? "<Unnamed book>" : "<Unnamed blueprint>"}
                      size="sm"
                    />
                  </span>
                  {progress && (
                    <span data-slot="tree-item-status" className="flex h-3 w-full items-center">
                      {progress.durationMs == null ? (
                        <Progress
                          value={progress.value}
                          aria-label={`${item.getItemName()}: ${progress.label}`}
                          className="w-full gap-0"
                        />
                      ) : (
                        <span
                          className="text-xs leading-none tabular-nums text-muted-foreground"
                          aria-label={`${item.getItemName()} rendered in ${renderedDuration}`}
                        >
                          {renderedDuration}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </TreeItemButton>
            </TreeItem>
          );
        })}
      </Tree>
    </div>
  );
};
