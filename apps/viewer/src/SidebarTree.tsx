import { Progress } from "@/components/ui/progress";
import {
  Tree,
  TreeExpandIcon,
  TreeItem,
  TreeItemButton,
  TreeItemIconSlot,
} from "@/components/ui/tree";
import { hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { type BlueprintDocument, type BookTreeItemKind, type Icon, buildBookTree } from "fpsr";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BlueprintIcons } from "./BlueprintIcons";
import { FactorioItemIcon } from "./FactorioItemIcon";
import { FactorioRichText } from "./FactorioRichText";

const INDENT_PX = 12;
const ROOT_ID = "root";

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
  children: string[];
}

export interface SidebarSource {
  id: SidebarSourceId;
  label: string;
  doc: BlueprintDocument;
}

export interface SidebarRenderProgress {
  sourceId: SidebarSourceId;
  path: number[] | null;
  value: number;
  label: string;
  durationMs?: number;
}

export function selectionId(sourceId: SidebarSourceId, path: number[] | null): string {
  if (!path || path.length === 0) return sourceId;
  return `${sourceId}:${path.join(".")}`;
}

function ancestorIdsForSelection(sourceId: SidebarSourceId, path: number[] | null): string[] {
  const ids = [ROOT_ID, sourceId];
  if (!path || path.length === 0) return ids;
  for (let i = 1; i < path.length; i++) {
    ids.push(`${sourceId}:${path.slice(0, i).join(".")}`);
  }
  return ids;
}

export function docToSidebarItems(source: SidebarSource): Record<string, SidebarTreeItem> {
  const book = buildBookTree(source.doc);
  if (book) {
    const items: Record<string, SidebarTreeItem> = {};
    for (const [id, item] of Object.entries(book.items)) {
      if (id === book.rootId) {
        items[source.id] = {
          id: source.id,
          sourceId: source.id,
          path: [],
          label: item.label || source.label,
          kind: "book",
          icons: item.icons,
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
        label: source.doc.blueprint.label || source.label,
        kind: "blueprint",
        icons: source.doc.blueprint.icons,
        children: [],
      },
    };
  }

  // Planner-only or empty docs: show as muted non-selectable leaf.
  return {
    [source.id]: {
      id: source.id,
      sourceId: source.id,
      path: [],
      label: source.label,
      kind: source.doc.upgrade_planner ? "upgrade_planner" : "deconstruction_planner",
      children: [],
    },
  };
}

function buildSidebarItems(sources: SidebarSource[]): Record<string, SidebarTreeItem> {
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
}

export function TreeItemKindIcon({ kind, icons }: { kind: BookTreeItemKind; icons?: Icon[] }) {
  if (kind === "blueprint" || kind === "book") {
    return (
      <BlueprintIcons
        icons={icons}
        size={36}
        backgroundKey={kind === "book" ? "item/blueprint-book" : "item/blueprint"}
      />
    );
  }

  return (
    <FactorioItemIcon
      iconKey={KIND_ICON_KEY[kind]}
      className="size-9"
      title={kind.replaceAll("_", " ")}
    />
  );
}

function formatRenderDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export type SidebarSelectableKind = "book" | "blueprint";

export function SidebarTree({
  sources,
  selectedSourceId,
  selectedPath,
  selectedKind,
  renderProgress,
  onSelect,
}: {
  sources: SidebarSource[];
  selectedSourceId: SidebarSourceId;
  selectedPath: number[] | null;
  selectedKind?: SidebarSelectableKind;
  renderProgress?: SidebarRenderProgress | null;
  onSelect: (sourceId: SidebarSourceId, path: number[], kind: SidebarSelectableKind) => void;
}) {
  const items = useMemo(() => buildSidebarItems(sources), [sources]);
  const selectedItemId = selectionId(selectedSourceId, selectedPath);
  const progressItemId = renderProgress
    ? selectionId(renderProgress.sourceId, renderProgress.path)
    : null;

  const [expandedItems, setExpandedItems] = useState<string[]>(() =>
    ancestorIdsForSelection(selectedSourceId, selectedPath),
  );

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

  const emptyItem = useMemo<SidebarTreeItem>(
    () => ({
      id: "",
      sourceId: "",
      path: [],
      label: "",
      kind: "blueprint",
      children: [],
    }),
    [],
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
      if (data?.kind === "book" || data?.kind === "blueprint") {
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
      getItem: (itemId) => items[itemId] ?? { ...emptyItem, id: itemId },
      getChildren: (itemId) => items[itemId]?.children ?? [],
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });

  const treeRef = useRef(tree);
  treeRef.current = tree;
  useLayoutEffect(() => {
    treeRef.current.rebuildTree();
  }, [items]);

  return (
    <Tree {...tree.getContainerProps("Blueprints")}>
      {tree.getItems().map((item) => {
        const id = item.getId();
        if (id === ROOT_ID) return null;
        const data = items[id];
        if (!data) return null;

        const isFolder = item.isFolder();
        const progress = id === progressItemId ? renderProgress : null;
        const renderedDuration =
          progress?.durationMs == null ? null : formatRenderDuration(progress.durationMs);
        const isPlanner = data.kind === "upgrade_planner" || data.kind === "deconstruction_planner";

        return (
          <TreeItem key={id}>
            <TreeItemButton
              {...item.getProps()}
              indent={item.getItemMeta().level * INDENT_PX}
              data-selected={item.isSelected() || undefined}
              data-focused={item.isFocused() || undefined}
              data-muted={isPlanner || undefined}
            >
              <TreeItemIconSlot>
                {isFolder ? (
                  <TreeExpandIcon expanded={item.isExpanded()} />
                ) : (
                  <span className="size-3.5" />
                )}
              </TreeItemIconSlot>
              <TreeItemIconSlot className="size-9">
                <TreeItemKindIcon kind={data.kind} icons={data.icons} />
              </TreeItemIconSlot>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1.5">
                <span className="min-w-0 truncate">
                  <FactorioRichText text={item.getItemName()} size="sm" />
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
  );
}
