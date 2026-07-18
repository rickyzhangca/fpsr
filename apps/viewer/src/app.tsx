import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type Blueprint,
  type BlueprintBook,
  BlueprintDecodeError,
  type BlueprintDocument,
  type DecodeStats,
  decodeWithStats,
  resolveActivePath,
  selectBlueprint,
  selectBook,
} from "fpsr";
import { useAtom } from "jotai";
import { InfoIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import beltRingBp from "../../../fixtures/golden/belt-ring.bp.txt?raw";
import pipePlantBp from "../../../fixtures/golden/pipe-plant.bp.txt?raw";
import smokeBp from "../../../fixtures/golden/smoke.bp.txt?raw";
import baseGameTestsBp from "../../../fixtures/visual-tests/base-game/book.bp.txt?raw";
import elevatedRailsTestsBp from "../../../fixtures/visual-tests/official-mods/elevated-rails.bp.txt?raw";
import qualityTestsBp from "../../../fixtures/visual-tests/official-mods/quality.bp.txt?raw";
import recyclerTestsBp from "../../../fixtures/visual-tests/official-mods/recycler.bp.txt?raw";
import spaceAgeTestsBp from "../../../fixtures/visual-tests/official-mods/space-age.bp.txt?raw";
import { trackEvent } from "./analytics";
import { BlueprintSummary } from "./blueprint-summary";
import { BookSummary } from "./book-summary";
import { GitHubLogo } from "./components/github-logo";
import { Logo } from "./components/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { addCustom, clearCustoms, listCustoms } from "./custom-blueprints-db";
import { PaneMessage } from "./pane-message";
import type { PerfReport } from "./perf-report";
import { PreviewPane } from "./preview-pane";
import type { PreviewRenderProgress } from "./preview-renderer";
import {
  type ActiveRenderProgress,
  sameRenderPath,
  updateActiveRenderProgress,
} from "./render-progress-state";
import { SidebarPanels } from "./sidebar-panels";
import { resolveSidebarSelection } from "./sidebar-selection";
import { SidebarSelectionTrigger } from "./sidebar-selection-trigger";
import { type SidebarSelectableKind, type SidebarSource } from "./sidebar-tree";
import { activeTabAtom, isViewerTab } from "./viewer-preferences";

const PerformancePane = lazy(() =>
  import("./performance-pane").then(({ PerformancePane }) => ({ default: PerformancePane })),
);
const ProcessPane = lazy(() =>
  import("./process-pane").then(({ ProcessPane }) => ({ default: ProcessPane })),
);
const ManualBlueprintDialog = lazy(() =>
  import("./manual-blueprint-dialog").then(({ ManualBlueprintDialog }) => ({
    default: ManualBlueprintDialog,
  })),
);
const MobileSidebar = lazy(() =>
  import("./mobile-sidebar").then(({ MobileSidebar }) => ({ default: MobileSidebar })),
);
const LAST_VIEW_KEY = "fpsr-viewer:last-view:v1";
const LEGACY_LAST_VIEW_KEY = "fpsr-viewer:last-view";
const SAMPLES = [
  { id: "smoke", label: "Smoke", value: smokeBp.trim() },
  { id: "belt-ring", label: "Belt ring", value: beltRingBp.trim() },
  { id: "pipe-plant", label: "Pipe plant", value: pipePlantBp.trim() },
] as const;
const TEST_BOOKS = [
  { id: "tests-base-game-2.1.11", label: "base items 2.1.11", value: baseGameTestsBp.trim() },
  {
    id: "tests-space-age-2.1.11",
    label: "space age items 2.1.11",
    value: spaceAgeTestsBp.trim(),
  },
  {
    id: "tests-quality-2.1.11",
    label: "quality items 2.1.11",
    value: qualityTestsBp.trim(),
  },
  {
    id: "tests-elevated-rails-2.1.11",
    label: "elevated rails items 2.1.11",
    value: elevatedRailsTestsBp.trim(),
  },
  {
    id: "tests-recycler-2.1.11",
    label: "recycler items 2.1.11",
    value: recyclerTestsBp.trim(),
  },
] as const;
const DEFAULT_SAMPLE = SAMPLES[0];
interface LastView {
  sourceId: string;
  path: number[] | null;
  kind: SidebarSelectableKind;
}
const readLastView = (): LastView | null => {
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
    const kind: SidebarSelectableKind = parsed.kind === "book" ? "book" : "blueprint";
    return { sourceId: parsed.sourceId, path, kind };
  } catch {
    return null;
  }
};
const writeLastView = (view: LastView): void => {
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
  } catch {
    // Last-view restoration is best-effort when storage is unavailable.
  }
};
const tryDecode = (
  source: string,
): {
  doc: BlueprintDocument;
  stats: DecodeStats;
} | null => {
  try {
    return decodeWithStats(source);
  } catch {
    return null;
  }
};
const sourceLabel = (doc: BlueprintDocument, fallback: string): string => {
  if (doc.blueprint?.label) return doc.blueprint.label;
  if (doc.blueprint_book?.label) return doc.blueprint_book.label;
  return fallback;
};
const decodeErrorMessage = (e: unknown): string => {
  if (e instanceof BlueprintDecodeError) return e.reason;
  if (e instanceof Error) return e.message;
  return "unknown error";
};
interface BuiltInSidebarSource extends SidebarSource {
  stats: DecodeStats;
}
const decodeBuiltInSources = (
  sources: readonly { id: string; label: string; value: string }[],
): BuiltInSidebarSource[] => {
  return sources.flatMap((source) => {
    const decoded = tryDecode(source.value);
    return decoded
      ? [
          {
            id: source.id,
            label: source.label,
            doc: decoded.doc,
            raw: source.value,
            stats: decoded.stats,
          },
        ]
      : [];
  });
};
const SAMPLE_SOURCES = decodeBuiltInSources(SAMPLES);
const TEST_SOURCES = decodeBuiltInSources(TEST_BOOKS);
const BUILT_IN_SOURCE_BY_ID = new Map(
  [...SAMPLE_SOURCES, ...TEST_SOURCES].map((source) => [source.id, source]),
);
const BUILT_IN_DECODE_STATS = Object.fromEntries(
  [...SAMPLE_SOURCES, ...TEST_SOURCES].map((source) => [source.id, source.stats]),
) as Record<string, DecodeStats>;
const resolveStoredSelection = (
  doc: BlueprintDocument,
  path: number[] | null,
  kind: SidebarSelectableKind,
): {
  path: number[] | null;
  kind: SidebarSelectableKind;
} => {
  if (kind === "book") {
    if (!doc.blueprint_book) {
      return { path: resolveActivePath(doc), kind: "blueprint" };
    }
    try {
      selectBook(doc, path ?? undefined);
      return { path, kind: "book" };
    } catch {
      return { path: null, kind: "book" };
    }
  }
  if (!doc.blueprint_book) return { path: null, kind: "blueprint" };
  try {
    selectBlueprint(doc, path ?? undefined);
    return { path, kind: "blueprint" };
  } catch {
    return { path: resolveActivePath(doc), kind: "blueprint" };
  }
};
const resolveSelectedBook = (
  doc: BlueprintDocument | null,
  path: number[] | null,
  kind: SidebarSelectableKind,
): BlueprintBook | null => {
  if (!doc || kind !== "book") return null;
  try {
    return selectBook(doc, path ?? undefined);
  } catch {
    return null;
  }
};
const resolveSelectedBlueprint = (
  doc: BlueprintDocument | null,
  path: number[] | null,
  kind: SidebarSelectableKind,
): Blueprint | null => {
  if (!doc || kind !== "blueprint") return null;
  try {
    if (doc.blueprint) return doc.blueprint;
    return doc.blueprint_book ? selectBlueprint(doc, path ?? undefined) : null;
  } catch {
    return null;
  }
};
const initialSelection = (): LastView => {
  const last = readLastView();
  if (last) {
    const builtIn = BUILT_IN_SOURCE_BY_ID.get(last.sourceId);
    if (builtIn) {
      const resolved = resolveStoredSelection(builtIn.doc, last.path, last.kind);
      return { sourceId: builtIn.id, ...resolved };
    }
  }
  return { sourceId: DEFAULT_SAMPLE.id, path: null, kind: "blueprint" };
};
const LazyPaneFallback = () => {
  return (
    <div className="flex min-h-48 items-center justify-center text-muted-foreground">Loading…</div>
  );
};
export const App = () => {
  const selectionRevisionRef = useRef(0);
  const [initial] = useState(initialSelection);
  const [selectedSourceId, setSelectedSourceId] = useState(initial.sourceId);
  const [selectedPath, setSelectedPath] = useState<number[] | null>(initial.path);
  const [selectedKind, setSelectedKind] = useState<SidebarSelectableKind>(initial.kind);
  const [selectionReady, setSelectionReady] = useState(false);
  const [customSources, setCustomSources] = useState<SidebarSource[]>([]);
  const [decodeStatsBySource, setDecodeStatsBySource] = useState<Record<string, DecodeStats>>(
    () => ({
      ...BUILT_IN_DECODE_STATS,
    }),
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSidebarMounted, setMobileSidebarMounted] = useState(false);
  const [tab, setTab] = useAtom(activeTabAtom);
  const [tileSize, setTileSize] = useState("—");
  const [perfReport, setPerfReport] = useState<PerfReport | null>(null);
  const [renderProgress, setRenderProgress] = useState<ActiveRenderProgress | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const initialSelectionRevision = selectionRevisionRef.current;
    void listCustoms()
      .then((records) => {
        if (cancelled) return;
        const sources: SidebarSource[] = [];
        const stats: Record<string, DecodeStats> = {};
        for (const record of records) {
          const decoded = tryDecode(record.raw);
          if (!decoded) continue;
          sources.push({
            id: record.id,
            label: sourceLabel(decoded.doc, "Untitled"),
            doc: decoded.doc,
            raw: record.raw,
          });
          stats[record.id] = decoded.stats;
        }
        setCustomSources(sources);
        setDecodeStatsBySource((prev) => ({ ...prev, ...stats }));
        const last = readLastView();
        if (last && selectionRevisionRef.current === initialSelectionRevision) {
          const source =
            BUILT_IN_SOURCE_BY_ID.get(last.sourceId) ?? sources.find((s) => s.id === last.sourceId);
          if (source) {
            const resolved = resolveStoredSelection(source.doc, last.path, last.kind);
            setSelectedSourceId(source.id);
            setSelectedPath(resolved.path);
            setSelectedKind(resolved.kind);
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          toast.error(decodeErrorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setSelectionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!selectionReady) return;
    writeLastView({ sourceId: selectedSourceId, path: selectedPath, kind: selectedKind });
  }, [selectionReady, selectedSourceId, selectedPath, selectedKind]);
  const allSources = [...SAMPLE_SOURCES, ...TEST_SOURCES, ...customSources];
  const sourceById = new Map(allSources.map((source) => [source.id, source]));
  const activeSource = sourceById.get(selectedSourceId) ?? null;
  const activeDoc = activeSource?.doc ?? null;
  const selectedBook = resolveSelectedBook(activeDoc, selectedPath, selectedKind);
  const selectedBlueprint = resolveSelectedBlueprint(activeDoc, selectedPath, selectedKind);
  useEffect(() => {
    setTileSize("—");
    setPerfReport(null);
    setRenderError(null);
  }, [selectedBlueprint]);
  const activeDecodeStats = decodeStatsBySource[selectedSourceId] ?? null;
  const addCustomFromString = async (source: string) => {
    const trimmed = source.trim();
    if (!trimmed) {
      toast.error("Paste a blueprint string first.");
      return false;
    }
    try {
      const { doc: decoded, stats } = decodeWithStats(trimmed);
      const record = await addCustom(trimmed);
      const label = sourceLabel(decoded, "Untitled");
      const next: SidebarSource = {
        id: record.id,
        label,
        doc: decoded,
        raw: trimmed,
      };
      setCustomSources((prev) => [...prev, next]);
      setDecodeStatsBySource((prev) => ({ ...prev, [record.id]: stats }));
      selectionRevisionRef.current += 1;
      setSelectedSourceId(record.id);
      setSelectedPath(resolveActivePath(decoded));
      setSelectedKind("blueprint");
      trackEvent("blueprint_load", {
        kind: decoded.blueprint_book ? "book" : "blueprint",
      });
      toast.success("Blueprint added", { description: label });
      return true;
    } catch (e) {
      toast.error(decodeErrorMessage(e));
      return false;
    }
  };
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      await addCustomFromString(text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read clipboard.");
    }
  };
  const clearAllCustoms = async () => {
    try {
      await clearCustoms();
      const wasCustom = customSources.some((s) => s.id === selectedSourceId);
      setCustomSources([]);
      if (wasCustom) {
        selectionRevisionRef.current += 1;
        setSelectedSourceId(DEFAULT_SAMPLE.id);
        setSelectedPath(null);
        setSelectedKind("blueprint");
      }
    } catch (e) {
      toast.error(decodeErrorMessage(e));
    }
  };
  const onTreeSelect = (sourceId: string, path: number[], kind: SidebarSelectableKind) => {
    selectionRevisionRef.current += 1;
    const normalizedPath = path.length === 0 ? null : path;
    if (
      sourceId !== selectedSourceId ||
      !sameRenderPath(normalizedPath, selectedPath) ||
      kind !== selectedKind
    ) {
      if (kind === "blueprint") {
        setRenderProgress({
          sourceId,
          path: normalizedPath,
          value: 1,
          label: "Queued",
        });
      } else {
        setRenderProgress(null);
      }
    }
    setSelectedSourceId(sourceId);
    setSelectedPath(normalizedPath);
    setSelectedKind(kind);
    if (kind === "blueprint") {
      setSidebarOpen(false);
    }
  };
  const onRenderProgress = useCallback(
    (progress: PreviewRenderProgress | null) => {
      setRenderProgress((previous) =>
        updateActiveRenderProgress(previous, progress, {
          sourceId: selectedSourceId,
          path: selectedPath,
        }),
      );
    },
    [selectedSourceId, selectedPath],
  );
  const sidebarSelection = resolveSidebarSelection(allSources, selectedSourceId, selectedPath);
  const selectedRenderProgress =
    renderProgress?.sourceId === selectedSourceId &&
    sameRenderPath(renderProgress.path, selectedPath)
      ? renderProgress
      : null;
  const sidebarPanelProps = {
    sampleSources: SAMPLE_SOURCES,
    testSources: TEST_SOURCES,
    customSources,
    selectedSourceId,
    selectedPath,
    selectedKind,
    renderProgress,
    onSelect: onTreeSelect,
    onPaste: () => void handlePaste(),
    onManualOpen: () => setManualOpen(true),
    onClearAllCustoms: () => void clearAllCustoms(),
  };
  return (
    <div className="grid h-svh overflow-hidden grid-rows-[auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 pl-4 pr-6 pt-4">
          <h1 className="text-lg font-semibold tracking-tight">
            <Logo />
            <span className="sr-only">FPSR Demo</span>
          </h1>
          <a
            href="https://github.com/rickyzhangca/fpsr"
            target="_blank"
            rel="noreferrer"
            aria-label="View fpsr on GitHub"
            className="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <GitHubLogo className="size-4" />
          </a>
        </div>

        <div className="mx-2 pt-3 md:hidden">
          <SidebarSelectionTrigger
            selection={sidebarSelection}
            aria-haspopup="dialog"
            aria-expanded={sidebarOpen}
            onClick={() => {
              setMobileSidebarMounted(true);
              setSidebarOpen(true);
            }}
          />
          {mobileSidebarMounted && (
            <Suspense fallback={null}>
              <MobileSidebar open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SidebarPanels {...sidebarPanelProps} />
              </MobileSidebar>
            </Suspense>
          )}
        </div>

        <ScrollArea className="hidden min-h-0 flex-1 md:flex" viewportClassName="scroll-fade">
          <SidebarPanels {...sidebarPanelProps} />
        </ScrollArea>
      </aside>

      {manualOpen && (
        <Suspense fallback={null}>
          <ManualBlueprintDialog
            open={manualOpen}
            onOpenChange={setManualOpen}
            onSubmit={addCustomFromString}
          />
        </Suspense>
      )}

      <div className="flex min-h-0 flex-col items-center md:p-2 px-2 pt-1 pb-1.5 gap-1 md:gap-2">
        <main className="flex-1 w-full flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
          <ScrollArea
            className="min-h-0 min-w-0 flex-1"
            viewportClassName="scroll-fade overflow-x-hidden"
            contentClassName="h-full w-full min-w-0"
          >
            <div className="flex h-full min-h-[640px] w-full min-w-0 flex-col">
              {selectedBook ? (
                <>
                  <BookSummary
                    book={selectedBook}
                    sourceBytes={
                      activeDoc?.blueprint_book && selectedPath == null
                        ? activeDecodeStats?.inputChars
                        : undefined
                    }
                    sourceString={
                      activeDoc?.blueprint_book && selectedPath == null
                        ? activeSource?.raw
                        : undefined
                    }
                  />
                  <PaneMessage className="border-t">
                    Select a blueprint in the sidebar to view it
                  </PaneMessage>
                </>
              ) : (
                <>
                  {selectedBlueprint ? (
                    <BlueprintSummary
                      blueprint={selectedBlueprint}
                      tileSize={tileSize}
                      sourceBytes={activeDoc?.blueprint ? activeDecodeStats?.inputChars : undefined}
                      sourceString={activeDoc?.blueprint ? activeSource?.raw : undefined}
                    />
                  ) : (
                    <PaneMessage className="min-h-32 flex-none">
                      Decode a blueprint to preview rendering.
                    </PaneMessage>
                  )}

                  <Tabs
                    value={tab}
                    onValueChange={(value) => {
                      if (!isViewerTab(value)) return;
                      setTab(value);
                      trackEvent("tab_switch", { tab: value });
                    }}
                    className="flex min-h-0 flex-1 flex-col overflow-hidden border-t"
                  >
                    <TabsList variant="line" className="mx-1 mt-1">
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                      <TabsTrigger value="process">Process</TabsTrigger>
                      <TabsTrigger value="performance">Performance</TabsTrigger>
                    </TabsList>

                    <TabsContent
                      value="preview"
                      keepMounted
                      className="flex min-h-0 flex-1 flex-col overflow-hidden"
                    >
                      <PreviewPane
                        doc={activeDoc}
                        blueprint={selectedBlueprint}
                        blueprintPath={selectedPath}
                        decodeStats={activeDecodeStats}
                        onTileSizeChange={setTileSize}
                        onPerfReport={setPerfReport}
                        onRenderProgress={onRenderProgress}
                        onRenderError={setRenderError}
                      />
                    </TabsContent>

                    <TabsContent
                      value="process"
                      className="flex min-h-0 flex-1 flex-col overflow-hidden"
                    >
                      {tab === "process" && (
                        <Suspense fallback={<LazyPaneFallback />}>
                          <ProcessPane
                            doc={activeDoc}
                            blueprint={selectedBlueprint}
                            blueprintPath={selectedPath}
                            decodeStats={activeDecodeStats}
                            perfReport={perfReport}
                            renderProgress={selectedRenderProgress}
                            renderError={renderError}
                          />
                        </Suspense>
                      )}
                    </TabsContent>

                    <TabsContent
                      value="performance"
                      className="flex min-h-0 flex-1 flex-col overflow-hidden"
                    >
                      {tab === "performance" && (
                        <Suspense fallback={<LazyPaneFallback />}>
                          <PerformancePane report={perfReport} />
                        </Suspense>
                      )}
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </div>
          </ScrollArea>
        </main>
        <p className="flex items-center gap-1 px-2 text-xs text-muted-foreground">
          All assets are owned by Wube Software
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-label="Factorio asset attribution details"
                />
              }
            >
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm text-pretty">
              All Factorio sprites, icons, and other game assets are © Wube Software Ltd. Factorio
              is a trademark of Wube Software. This is an unofficial fan project and is not
              affiliated with or endorsed by Wube Software.
            </TooltipContent>
          </Tooltip>
        </p>
      </div>
    </div>
  );
};
