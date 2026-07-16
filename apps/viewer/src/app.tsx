import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import beltRingBp from "../../../fixtures/golden/belt-ring.bp.txt?raw";
import pipePlantBp from "../../../fixtures/golden/pipe-plant.bp.txt?raw";
import smokeBp from "../../../fixtures/golden/smoke.bp.txt?raw";
import baseGameTestsBp from "../../../fixtures/visual-tests/base-game/book.bp.txt?raw";
import elevatedRailsTestsBp from "../../../fixtures/visual-tests/official-mods/elevated-rails.bp.txt?raw";
import qualityTestsBp from "../../../fixtures/visual-tests/official-mods/quality.bp.txt?raw";
import recyclerTestsBp from "../../../fixtures/visual-tests/official-mods/recycler.bp.txt?raw";
import spaceAgeTestsBp from "../../../fixtures/visual-tests/official-mods/space-age.bp.txt?raw";
import { BlueprintSummary } from "./blueprint-summary";
import { BookSummary } from "./book-summary";
import { ComparePane } from "./compare-pane";
import { Logo } from "./components/logo";
import { addCustom, clearCustoms, listCustoms } from "./custom-blueprints-db";
import type { PerfReport } from "./perf-report";
import { PerformancePane } from "./performance-pane";
import { PreviewPane } from "./preview-pane";
import type { PreviewRenderProgress } from "./preview-renderer";
import { ProcessPane } from "./process-pane";
import {
  type ActiveRenderProgress,
  sameRenderPath,
  updateActiveRenderProgress,
} from "./render-progress-state";
import { SidebarPanels } from "./sidebar-panels";
import { resolveSidebarSelection } from "./sidebar-selection";
import { SidebarSelectionTrigger } from "./sidebar-selection-trigger";
import { type SidebarSelectableKind, type SidebarSource } from "./sidebar-tree";
type Tab = "preview" | "process" | "performance" | "compare";
const LAST_VIEW_KEY = "fpsr-viewer:last-view";
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
const BUILT_IN_SOURCES = [...SAMPLES, ...TEST_BOOKS];
const DEFAULT_SAMPLE = SAMPLES[0];
interface LastView {
  sourceId: string;
  path: number[] | null;
  kind: SidebarSelectableKind;
}
const readLastView = (): LastView | null => {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastView>;
    if (typeof parsed.sourceId !== "string") return null;
    const path =
      Array.isArray(parsed.path) && parsed.path.every((n) => typeof n === "number")
        ? parsed.path
        : null;
    const kind: SidebarSelectableKind = parsed.kind === "book" ? "book" : "blueprint";
    return { sourceId: parsed.sourceId, path, kind };
  } catch {
    return null;
  }
};
const writeLastView = (view: LastView): void => {
  localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
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
const initialSelection = (): LastView => {
  const last = readLastView();
  if (last) {
    const builtIn = BUILT_IN_SOURCES.find((source) => source.id === last.sourceId);
    if (builtIn) {
      const decoded = tryDecode(builtIn.value);
      if (decoded) {
        const resolved = resolveStoredSelection(decoded.doc, last.path, last.kind);
        return { sourceId: builtIn.id, ...resolved };
      }
    }
  }
  return { sourceId: DEFAULT_SAMPLE.id, path: null, kind: "blueprint" };
};
export const App = () => {
  const [selectedSourceId, setSelectedSourceId] = useState(() => initialSelection().sourceId);
  const [selectedPath, setSelectedPath] = useState<number[] | null>(() => initialSelection().path);
  const [selectedKind, setSelectedKind] = useState<SidebarSelectableKind>(
    () => initialSelection().kind,
  );
  const [selectionReady, setSelectionReady] = useState(false);
  const [customSources, setCustomSources] = useState<SidebarSource[]>([]);
  const [decodeStatsBySource, setDecodeStatsBySource] = useState<Record<string, DecodeStats>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [tab, setTab] = useState<Tab>("preview");
  const [tileSize, setTileSize] = useState("—");
  const [perfReport, setPerfReport] = useState<PerfReport | null>(null);
  const [renderProgress, setRenderProgress] = useState<ActiveRenderProgress | null>(null);
  const sampleSources: SidebarSource[] = useMemo(
    () =>
      SAMPLES.flatMap((sample) => {
        const decoded = tryDecode(sample.value);
        if (!decoded) return [];
        return [{ id: sample.id, label: sample.label, doc: decoded.doc }];
      }),
    [],
  );
  const testSources: SidebarSource[] = useMemo(
    () =>
      TEST_BOOKS.flatMap((testBook) => {
        const decoded = tryDecode(testBook.value);
        if (!decoded) return [];
        return [{ id: testBook.id, label: testBook.label, doc: decoded.doc }];
      }),
    [],
  );
  // Publish built-in decode stats on mount.
  useEffect(() => {
    const stats: Record<string, DecodeStats> = {};
    for (const source of BUILT_IN_SOURCES) {
      const decoded = tryDecode(source.value);
      if (decoded) stats[source.id] = decoded.stats;
    }
    setDecodeStatsBySource((prev) => ({ ...stats, ...prev }));
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const records = await listCustoms();
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
          });
          stats[record.id] = decoded.stats;
        }
        setCustomSources(sources);
        setDecodeStatsBySource((prev) => ({ ...prev, ...stats }));
        const last = readLastView();
        if (last) {
          const source =
            sampleSources.find((s) => s.id === last.sourceId) ??
            testSources.find((s) => s.id === last.sourceId) ??
            sources.find((s) => s.id === last.sourceId);
          if (source) {
            const resolved = resolveStoredSelection(source.doc, last.path, last.kind);
            setSelectedSourceId(source.id);
            setSelectedPath(resolved.path);
            setSelectedKind(resolved.kind);
          }
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(decodeErrorMessage(e));
        }
      } finally {
        if (!cancelled) setSelectionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sampleSources, testSources]);
  useEffect(() => {
    if (!selectionReady) return;
    writeLastView({ sourceId: selectedSourceId, path: selectedPath, kind: selectedKind });
  }, [selectionReady, selectedSourceId, selectedPath, selectedKind]);
  const activeDoc = useMemo(() => {
    return (
      sampleSources.find((s) => s.id === selectedSourceId)?.doc ??
      testSources.find((s) => s.id === selectedSourceId)?.doc ??
      customSources.find((s) => s.id === selectedSourceId)?.doc ??
      null
    );
  }, [selectedSourceId, sampleSources, testSources, customSources]);
  const selectedBook: BlueprintBook | null = useMemo(() => {
    if (!activeDoc || selectedKind !== "book") return null;
    try {
      return selectBook(activeDoc, selectedPath ?? undefined);
    } catch {
      return null;
    }
  }, [activeDoc, selectedKind, selectedPath]);
  const selectedBlueprint: Blueprint | null = useMemo(() => {
    if (!activeDoc || selectedKind !== "blueprint") return null;
    try {
      if (activeDoc.blueprint) return activeDoc.blueprint;
      if (activeDoc.blueprint_book) {
        return selectBlueprint(activeDoc, selectedPath ?? undefined);
      }
      return null;
    } catch {
      return null;
    }
  }, [activeDoc, selectedKind, selectedPath]);
  useEffect(() => {
    setTileSize("—");
    setPerfReport(null);
  }, [selectedBlueprint]);
  const activeDecodeStats = decodeStatsBySource[selectedSourceId] ?? null;
  const addCustomFromString = useCallback(async (source: string) => {
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
      };
      setCustomSources((prev) => [...prev, next]);
      setDecodeStatsBySource((prev) => ({ ...prev, [record.id]: stats }));
      setSelectedSourceId(record.id);
      setSelectedPath(resolveActivePath(decoded));
      setSelectedKind("blueprint");
      toast.success("Blueprint added", { description: label });
      return true;
    } catch (e) {
      toast.error(decodeErrorMessage(e));
      return false;
    }
  }, []);
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      await addCustomFromString(text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read clipboard.");
    }
  }, [addCustomFromString]);
  const handleManualSubmit = useCallback(async () => {
    const ok = await addCustomFromString(manualDraft);
    if (ok) {
      setManualDraft("");
      setManualOpen(false);
    }
  }, [addCustomFromString, manualDraft]);
  const clearAllCustoms = useCallback(async () => {
    try {
      await clearCustoms();
      const wasCustom = customSources.some((s) => s.id === selectedSourceId);
      setCustomSources([]);
      if (wasCustom) {
        setSelectedSourceId(DEFAULT_SAMPLE.id);
        setSelectedPath(null);
        setSelectedKind("blueprint");
      }
    } catch (e) {
      toast.error(decodeErrorMessage(e));
    }
  }, [customSources, selectedSourceId]);
  const onTreeSelect = (sourceId: string, path: number[], kind: SidebarSelectableKind) => {
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
  const isGoldenSelected = SAMPLES.some((sample) => sample.id === selectedSourceId);
  const allSources = useMemo(
    () => [...sampleSources, ...testSources, ...customSources],
    [sampleSources, testSources, customSources],
  );
  const sidebarSelection = useMemo(
    () => resolveSidebarSelection(allSources, selectedSourceId, selectedPath),
    [allSources, selectedSourceId, selectedPath],
  );
  const sidebarPanelProps = {
    sampleSources,
    testSources,
    customSources,
    selectedSourceId,
    selectedPath,
    selectedKind,
    renderProgress,
    onSelect: onTreeSelect,
    onPaste: () => void handlePaste(),
    onManualOpen: () => {
      setManualDraft("");
      setManualOpen(true);
    },
    onClearAllCustoms: () => void clearAllCustoms(),
  };
  return (
    <div className="grid h-svh overflow-hidden grid-rows-[auto_minmax(0,1fr)] md:grid-rows-none md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-hidden">
        <h1 className="text-lg font-semibold tracking-tight px-4 pt-4">
          <Logo />
          <span className="sr-only">FPSR Demo</span>
        </h1>

        <div className="mx-2 pt-3 md:hidden">
          <Drawer
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            showSwipeHandle
            swipeDirection="down"
          >
            <DrawerTrigger render={<SidebarSelectionTrigger selection={sidebarSelection} />} />
            <DrawerContent className="[--drawer-content-height:min(70vh,600px)]">
              <DrawerHeader>
                <DrawerTitle>Blueprints</DrawerTitle>
                <DrawerDescription className="sr-only">
                  Select a blueprint or blueprint book
                </DrawerDescription>
              </DrawerHeader>
              <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
                <SidebarPanels {...sidebarPanelProps} />
              </ScrollArea>
            </DrawerContent>
          </Drawer>
        </div>

        <ScrollArea className="hidden min-h-0 flex-1 md:flex" viewportClassName="scroll-fade">
          <SidebarPanels {...sidebarPanelProps} />
        </ScrollArea>
      </aside>

      <Dialog
        open={manualOpen}
        onOpenChange={(open) => {
          setManualOpen(open);
          if (!open) setManualDraft("");
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enter blueprint string</DialogTitle>
            <DialogDescription>
              Paste a Factorio blueprint string to add it to Custom.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={manualDraft}
            onChange={(e) => setManualDraft(e.target.value)}
            placeholder="Paste a blueprint string here…"
            className="h-40 resize-none font-mono text-xs"
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={() => void handleManualSubmit()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="m-2 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card md:ml-2 md:mr-3 md:my-3">
        <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
          <div className="flex min-h-full flex-col">
            {selectedBook ? (
              <>
                <BookSummary
                  book={selectedBook}
                  sourceBytes={
                    activeDoc?.blueprint_book && selectedPath == null
                      ? activeDecodeStats?.inputChars
                      : undefined
                  }
                />
                <div className="flex min-h-[480px] flex-1 flex-col items-center justify-center border-t px-4 py-4 text-sm text-muted-foreground">
                  Select a blueprint in the sidebar to view it
                </div>
              </>
            ) : (
              <>
                {selectedBlueprint ? (
                  <BlueprintSummary
                    blueprint={selectedBlueprint}
                    tileSize={tileSize}
                    sourceBytes={activeDoc?.blueprint ? activeDecodeStats?.inputChars : undefined}
                  />
                ) : (
                  <div className="shrink-0 px-4 pt-4 pb-4">
                    <div className="rounded-lg border border-dashed px-8 py-12 text-center text-muted-foreground">
                      Decode a blueprint to preview rendering.
                    </div>
                  </div>
                )}

                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as Tab)}
                  className="flex min-h-[480px] flex-1 flex-col border-t"
                >
                  <TabsList variant="line" className="mx-1 mt-1">
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                    <TabsTrigger value="process">Process</TabsTrigger>
                    <TabsTrigger value="performance">Performance</TabsTrigger>
                    <TabsTrigger value="compare">Compare</TabsTrigger>
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
                    />
                  </TabsContent>

                  <TabsContent
                    value="compare"
                    className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  >
                    {tab === "compare" && (
                      <ScrollArea className="min-h-0 flex-1">
                        <ComparePane caseName={isGoldenSelected ? selectedSourceId : null} />
                      </ScrollArea>
                    )}
                  </TabsContent>

                  <TabsContent
                    value="process"
                    className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  >
                    {tab === "process" && (
                      <ProcessPane doc={activeDoc} blueprint={selectedBlueprint} />
                    )}
                  </TabsContent>

                  <TabsContent
                    value="performance"
                    className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  >
                    {tab === "performance" && <PerformancePane report={perfReport} />}
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
};
