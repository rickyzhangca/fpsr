import { addCustom, clearCustoms, listCustoms } from "@/blueprint/custom-blueprints-db";
import { GitHubLogo } from "@/components/github-logo";
import { Logo } from "@/components/logo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PerfReport } from "@/performance/perf-report";
import { PreviewPane } from "@/preview/preview-pane";
import {
  type ActiveRenderProgress,
  sameRenderPath,
  updateActiveRenderProgress,
} from "@/preview/render-progress-state";
import type { PreviewRenderProgress } from "@/preview/render-worker-protocol";
import { trackEvent } from "@/shell/analytics";
import {
  BUILT_IN_DECODE_STATS,
  BUILT_IN_SOURCE_BY_ID,
  DEFAULT_SAMPLE,
  initialSelection,
  resolveSelectedBlueprint,
  resolveSelectedBook,
  resolveSelectedDeconstructionPlanner,
  resolveSelectedUpgradePlanner,
  resolveStoredSelection,
  SAMPLE_SOURCES,
  selectionForDoc,
  sourceLabel,
  TEST_SOURCES,
  tryDecode,
} from "@/shell/built-in-sources";
import { ensureEmbedMessageCapture, subscribeEmbedMessages } from "@/shell/embed-bridge";
import { readEmbedParam, readImportParam, stripImportParam } from "@/shell/embed-mode";
import {
  createErrorMessage,
  createLoadedMessage,
  createReadyMessage,
  docKindFromDocument,
  EMBED_SOURCE_ID,
  type EmbedDocKind,
  type EmbedOutboundMessage,
  parseEmbedMessage,
  postToEmbedParent,
  replyToEmbedSource,
} from "@/shell/embed-protocol";
import { readLastView, writeLastView } from "@/shell/last-view";
import { PaneMessage } from "@/shell/pane-message";
import { fetchBlueprintViaProxy, readSourceParam, stripSourceParam } from "@/shell/source-proxy";
import { activeTabAtom, isViewerTab } from "@/shell/viewer-preferences";
import { BlueprintSummary } from "@/sidebar/blueprint-summary";
import { BookSummary } from "@/sidebar/book-summary";
import { DeconstructionPlannerSummary } from "@/sidebar/deconstruction-planner-summary";
import { SidebarPanels } from "@/sidebar/sidebar-panels";
import { resolveSidebarSelection } from "@/sidebar/sidebar-selection";
import { SidebarSelectionTrigger } from "@/sidebar/sidebar-selection-trigger";
import { type SidebarSelectableKind, type SidebarSource } from "@/sidebar/sidebar-tree";
import { UpgradePlannerSummary } from "@/sidebar/upgrade-planner-summary";
import { BlueprintDecodeError, type DecodeStats, decodeWithStats } from "@rickyzhangca/fpsr";
import { useAtom } from "jotai";
import { InfoIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

ensureEmbedMessageCapture();

const PerformancePane = lazy(() =>
  import("@/performance/performance-pane").then(({ PerformancePane }) => ({
    default: PerformancePane,
  })),
);
const ProcessPane = lazy(() =>
  import("@/process/process-pane").then(({ ProcessPane }) => ({ default: ProcessPane })),
);
const ManualBlueprintDialog = lazy(() =>
  import("@/blueprint/manual-blueprint-dialog").then(({ ManualBlueprintDialog }) => ({
    default: ManualBlueprintDialog,
  })),
);
const MobileSidebar = lazy(() =>
  import("@/sidebar/mobile-sidebar").then(({ MobileSidebar }) => ({ default: MobileSidebar })),
);

const decodeErrorMessage = (e: unknown): string => {
  if (e instanceof BlueprintDecodeError) return e.reason;
  if (e instanceof Error) return e.message;
  return "unknown error";
};

const LazyPaneFallback = () => {
  return (
    <div className="flex min-h-48 items-center justify-center text-muted-foreground">Loading…</div>
  );
};

export const App = () => {
  const [embed] = useState(() => readEmbedParam());
  const selectionRevisionRef = useRef(0);
  const [initial] = useState(() => (embed ? null : initialSelection()));
  const [selectedSourceId, setSelectedSourceId] = useState(() =>
    embed ? EMBED_SOURCE_ID : (initial?.sourceId ?? DEFAULT_SAMPLE.id),
  );
  const [selectedPath, setSelectedPath] = useState<number[] | null>(() =>
    embed ? null : (initial?.path ?? null),
  );
  const [selectedKind, setSelectedKind] = useState<SidebarSelectableKind>(() =>
    embed ? "blueprint" : (initial?.kind ?? "blueprint"),
  );
  const [selectionReady, setSelectionReady] = useState(embed);
  const [customSources, setCustomSources] = useState<SidebarSource[]>([]);
  const [embedSource, setEmbedSource] = useState<SidebarSource | null>(null);
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
    if (embed) return;
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
  }, [embed]);

  useEffect(() => {
    if (embed || !selectionReady) return;
    writeLastView({ sourceId: selectedSourceId, path: selectedPath, kind: selectedKind });
  }, [embed, selectionReady, selectedSourceId, selectedPath, selectedKind]);

  const allSources = embed
    ? embedSource
      ? [embedSource]
      : []
    : [...SAMPLE_SOURCES, ...TEST_SOURCES, ...customSources];
  const sourceById = new Map(allSources.map((source) => [source.id, source]));
  const activeSource = sourceById.get(selectedSourceId) ?? null;
  const activeDoc = activeSource?.doc ?? null;
  const selectedBook = resolveSelectedBook(activeDoc, selectedPath, selectedKind);
  const selectedBlueprint = resolveSelectedBlueprint(activeDoc, selectedPath, selectedKind);
  const selectedUpgradePlanner = resolveSelectedUpgradePlanner(
    activeDoc,
    selectedPath,
    selectedKind,
  );
  const selectedDeconstructionPlanner = resolveSelectedDeconstructionPlanner(
    activeDoc,
    selectedPath,
    selectedKind,
  );
  useEffect(() => {
    setTileSize("—");
    setPerfReport(null);
    setRenderError(null);
  }, [selectedBlueprint, selectedUpgradePlanner, selectedDeconstructionPlanner]);
  const activeDecodeStats = decodeStatsBySource[selectedSourceId] ?? null;

  const applyEmbedBlueprint = useCallback((raw: string): EmbedOutboundMessage => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return createErrorMessage("Missing blueprint string.");
    }
    try {
      const { doc: decoded, stats } = decodeWithStats(trimmed);
      const label = sourceLabel(decoded, "Untitled");
      const next: SidebarSource = {
        id: EMBED_SOURCE_ID,
        label,
        doc: decoded,
        raw: trimmed,
      };
      setEmbedSource(next);
      setDecodeStatsBySource((prev) => ({ ...prev, [EMBED_SOURCE_ID]: stats }));
      selectionRevisionRef.current += 1;
      const selection = selectionForDoc(decoded);
      setSelectedSourceId(EMBED_SOURCE_ID);
      setSelectedPath(selection.path);
      setSelectedKind(selection.kind);
      const kind = docKindFromDocument(decoded);
      trackEvent("embed_load", { kind });
      return createLoadedMessage(kind);
    } catch (e) {
      return createErrorMessage(decodeErrorMessage(e));
    }
  }, []);

  useLayoutEffect(() => {
    if (!embed) return;

    let gotLoad = false;
    const handleEvent = (event: MessageEvent) => {
      const parsed = parseEmbedMessage(event.data);
      if (!parsed.ok) {
        if (
          typeof event.data === "object" &&
          event.data !== null &&
          !Array.isArray(event.data) &&
          (event.data as { type?: unknown }).type === "fpsr:load" &&
          parsed.reason
        ) {
          replyToEmbedSource(event.source, event.origin, createErrorMessage(parsed.reason));
        }
        return;
      }
      gotLoad = true;
      const result = applyEmbedBlueprint(parsed.message.blueprint);
      replyToEmbedSource(event.source, event.origin, result);
    };

    const unsubscribe = subscribeEmbedMessages(handleEvent);
    const announceReady = () => {
      if (gotLoad) return;
      postToEmbedParent(createReadyMessage());
    };
    // Parent pages (docs islands, third-party embeds) may attach their
    // message listener after this iframe already booted — re-announce until load.
    announceReady();
    const readyInterval = window.setInterval(announceReady, 250);
    const readyTimeout = window.setTimeout(() => window.clearInterval(readyInterval), 15_000);
    return () => {
      gotLoad = true;
      window.clearInterval(readyInterval);
      window.clearTimeout(readyTimeout);
      unsubscribe();
    };
  }, [embed, applyEmbedBlueprint]);

  const addCustomFromString = useCallback(async (source: string): Promise<EmbedDocKind | false> => {
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
      const selection = selectionForDoc(decoded);
      setSelectedSourceId(record.id);
      setSelectedPath(selection.path);
      setSelectedKind(selection.kind);
      const kind = docKindFromDocument(decoded);
      trackEvent("blueprint_load", { kind });
      toast.success("Blueprint added", { description: label });
      return kind;
    } catch (e) {
      toast.error(decodeErrorMessage(e));
      return false;
    }
  }, []);

  useEffect(() => {
    if (embed || !readImportParam()) return;
    if (!window.opener) {
      stripImportParam();
      return;
    }

    window.opener.postMessage(createReadyMessage(), window.location.origin);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.opener) return;
      const parsed = parseEmbedMessage(event.data);
      if (!parsed.ok) {
        if (
          typeof event.data === "object" &&
          event.data !== null &&
          !Array.isArray(event.data) &&
          (event.data as { type?: unknown }).type === "fpsr:load" &&
          parsed.reason
        ) {
          replyToEmbedSource(event.source, event.origin, createErrorMessage(parsed.reason));
        }
        return;
      }
      stripImportParam();
      void addCustomFromString(parsed.message.blueprint).then((kind) => {
        replyToEmbedSource(
          event.source,
          event.origin,
          kind === false
            ? createErrorMessage("Could not import blueprint.")
            : createLoadedMessage(kind),
        );
      });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed, addCustomFromString]);

  useEffect(() => {
    if (embed) return;
    const source = readSourceParam();
    if (!source) return;
    let cancelled = false;
    const toastId = toast.loading("Loading blueprint from URL…");
    void (async () => {
      try {
        const text = await fetchBlueprintViaProxy(source);
        if (cancelled) return;
        await addCustomFromString(text);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Could not load blueprint from URL.");
        }
      } finally {
        toast.dismiss(toastId);
        if (!cancelled) stripSourceParam();
      }
    })();
    return () => {
      cancelled = true;
      toast.dismiss(toastId);
    };
  }, [embed, addCustomFromString]);

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
      if (kind === "blueprint" || kind === "upgrade_planner" || kind === "deconstruction_planner") {
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
    if (kind === "blueprint" || kind === "upgrade_planner" || kind === "deconstruction_planner") {
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

  const hasEmbedPreview =
    Boolean(selectedBlueprint) ||
    Boolean(selectedUpgradePlanner) ||
    Boolean(selectedDeconstructionPlanner);

  if (embed) {
    return (
      <div className="flex h-svh min-h-0 w-full flex-col overflow-hidden bg-background">
        {hasEmbedPreview ? (
          <PreviewPane
            embed
            doc={activeDoc}
            blueprint={selectedBlueprint}
            upgradePlanner={selectedUpgradePlanner}
            deconstructionPlanner={selectedDeconstructionPlanner}
            blueprintPath={selectedPath}
            decodeStats={activeDecodeStats}
            sourceString={activeSource?.raw ?? null}
            onTileSizeChange={setTileSize}
            onPerfReport={setPerfReport}
            onRenderProgress={onRenderProgress}
            onRenderError={setRenderError}
          />
        ) : (
          <PaneMessage className="flex flex-1 items-center justify-center">
            Waiting for blueprint…
          </PaneMessage>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-svh overflow-hidden grid-rows-[auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden">
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

        <ScrollArea
          className="hidden min-h-0 min-w-0 flex-1 md:flex"
          viewportClassName="scroll-fade overflow-x-hidden"
          contentClassName="min-w-0! w-full max-w-full"
        >
          <SidebarPanels {...sidebarPanelProps} />
        </ScrollArea>
      </aside>

      {manualOpen && (
        <Suspense fallback={null}>
          <ManualBlueprintDialog
            open={manualOpen}
            onOpenChange={setManualOpen}
            onSubmit={async (source) => (await addCustomFromString(source)) !== false}
          />
        </Suspense>
      )}

      <div className="flex min-h-0 min-w-0 w-full max-w-full flex-col items-center md:p-2 px-2 pt-1 pb-1.5 gap-1 md:gap-2">
        <main className="flex-1 w-full flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
          <ScrollArea
            className="min-h-0 min-w-0 flex-1"
            viewportClassName="scroll-fade overflow-x-hidden"
            contentClassName="min-h-full min-w-0! flex flex-col w-full max-w-full"
          >
            <div className="flex flex-1 min-h-[max(100%,640px)] w-full max-w-full min-w-0 flex-col">
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
                  {selectedUpgradePlanner ? (
                    <UpgradePlannerSummary
                      planner={selectedUpgradePlanner}
                      sourceBytes={
                        activeDoc?.upgrade_planner ? activeDecodeStats?.inputChars : undefined
                      }
                      sourceString={activeDoc?.upgrade_planner ? activeSource?.raw : undefined}
                    />
                  ) : selectedDeconstructionPlanner ? (
                    <DeconstructionPlannerSummary
                      planner={selectedDeconstructionPlanner}
                      sourceBytes={
                        activeDoc?.deconstruction_planner
                          ? activeDecodeStats?.inputChars
                          : undefined
                      }
                      sourceString={
                        activeDoc?.deconstruction_planner ? activeSource?.raw : undefined
                      }
                    />
                  ) : selectedBlueprint ? (
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

                  {(selectedBlueprint ||
                    selectedUpgradePlanner ||
                    selectedDeconstructionPlanner) && (
                    <Tabs
                      value={tab}
                      onValueChange={(value) => {
                        if (!isViewerTab(value)) return;
                        setTab(value);
                        trackEvent("tab_switch", { tab: value });
                      }}
                      className="flex min-h-80 flex-1 flex-col overflow-hidden border-t"
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
                          upgradePlanner={selectedUpgradePlanner}
                          deconstructionPlanner={selectedDeconstructionPlanner}
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
                  )}
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
