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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type Blueprint,
  BlueprintDecodeError,
  type BlueprintDocument,
  type DecodeStats,
  decodeWithStats,
  resolveActivePath,
  selectBlueprint,
} from "fpsr";
import { ClipboardIcon, EllipsisVerticalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import beltRingBp from "../../../fixtures/golden/belt-ring.bp.txt?raw";
import pipePlantBp from "../../../fixtures/golden/pipe-plant.bp.txt?raw";
import smokeBp from "../../../fixtures/golden/smoke.bp.txt?raw";
import baseGameTestsBp from "../../../fixtures/visual-tests/base-game/book.bp.txt?raw";
import { BlueprintSummary } from "./BlueprintSummary";
import { ComparePane } from "./ComparePane";
import { addCustom, clearCustoms, listCustoms } from "./customBlueprintsDb";
import { PerformancePane } from "./PerformancePane";
import type { PerfReport } from "./perfReport";
import { PreviewPane } from "./PreviewPane";
import type { PreviewRenderProgress } from "./previewRenderer";
import { ProcessPane } from "./ProcessPane";
import {
  type ActiveRenderProgress,
  sameRenderPath,
  updateActiveRenderProgress,
} from "./renderProgressState";
import { type SidebarSource, SidebarTree } from "./SidebarTree";

type Tab = "preview" | "process" | "performance" | "compare";

const LAST_VIEW_KEY = "fpsr-viewer:last-view";

const SAMPLES = [
  { id: "smoke", label: "Smoke", value: smokeBp.trim() },
  { id: "belt-ring", label: "Belt ring", value: beltRingBp.trim() },
  { id: "pipe-plant", label: "Pipe plant", value: pipePlantBp.trim() },
] as const;

const TEST_BOOKS = [
  { id: "tests-base-game-2.1.11", label: "base items 2.1.11", value: baseGameTestsBp.trim() },
] as const;

const BUILT_IN_SOURCES = [...SAMPLES, ...TEST_BOOKS];

const DEFAULT_SAMPLE = SAMPLES[0];

interface LastView {
  sourceId: string;
  path: number[] | null;
}

function readLastView(): LastView | null {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastView>;
    if (typeof parsed.sourceId !== "string") return null;
    const path =
      Array.isArray(parsed.path) && parsed.path.every((n) => typeof n === "number")
        ? parsed.path
        : null;
    return { sourceId: parsed.sourceId, path };
  } catch {
    return null;
  }
}

function writeLastView(view: LastView): void {
  localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
}

function tryDecode(source: string): { doc: BlueprintDocument; stats: DecodeStats } | null {
  try {
    return decodeWithStats(source);
  } catch {
    return null;
  }
}

function sourceLabel(doc: BlueprintDocument, fallback: string): string {
  if (doc.blueprint?.label) return doc.blueprint.label;
  if (doc.blueprint_book?.label) return doc.blueprint_book.label;
  return fallback;
}

function decodeErrorMessage(e: unknown): string {
  if (e instanceof BlueprintDecodeError) return e.reason;
  if (e instanceof Error) return e.message;
  return "unknown error";
}

function resolveStoredPath(doc: BlueprintDocument, path: number[] | null): number[] | null {
  if (!doc.blueprint_book) return null;
  try {
    selectBlueprint(doc, path ?? undefined);
    return path;
  } catch {
    return resolveActivePath(doc);
  }
}

function initialSelection(): LastView {
  const last = readLastView();
  if (last) {
    const builtIn = BUILT_IN_SOURCES.find((source) => source.id === last.sourceId);
    if (builtIn) {
      const decoded = tryDecode(builtIn.value);
      if (decoded) {
        return { sourceId: builtIn.id, path: resolveStoredPath(decoded.doc, last.path) };
      }
    }
  }
  return { sourceId: DEFAULT_SAMPLE.id, path: null };
}

export function App() {
  const [selectedSourceId, setSelectedSourceId] = useState(() => initialSelection().sourceId);
  const [selectedPath, setSelectedPath] = useState<number[] | null>(() => initialSelection().path);
  const [selectionReady, setSelectionReady] = useState(false);
  const [customSources, setCustomSources] = useState<SidebarSource[]>([]);
  const [decodeStatsBySource, setDecodeStatsBySource] = useState<Record<string, DecodeStats>>({});
  const [manualOpen, setManualOpen] = useState(false);
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
            setSelectedSourceId(source.id);
            setSelectedPath(resolveStoredPath(source.doc, last.path));
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
    writeLastView({ sourceId: selectedSourceId, path: selectedPath });
  }, [selectionReady, selectedSourceId, selectedPath]);

  const activeDoc = useMemo(() => {
    return (
      sampleSources.find((s) => s.id === selectedSourceId)?.doc ??
      testSources.find((s) => s.id === selectedSourceId)?.doc ??
      customSources.find((s) => s.id === selectedSourceId)?.doc ??
      null
    );
  }, [selectedSourceId, sampleSources, testSources, customSources]);

  const selectedBlueprint: Blueprint | null = useMemo(() => {
    if (!activeDoc) return null;
    try {
      if (activeDoc.blueprint) return activeDoc.blueprint;
      if (activeDoc.blueprint_book) {
        return selectBlueprint(activeDoc, selectedPath ?? undefined);
      }
      return null;
    } catch {
      return null;
    }
  }, [activeDoc, selectedPath]);

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
      }
    } catch (e) {
      toast.error(decodeErrorMessage(e));
    }
  }, [customSources, selectedSourceId]);

  const onTreeSelect = (sourceId: string, path: number[]) => {
    const normalizedPath = path.length === 0 ? null : path;
    if (sourceId !== selectedSourceId || !sameRenderPath(normalizedPath, selectedPath)) {
      setRenderProgress({
        sourceId,
        path: normalizedPath,
        value: 1,
        label: "Queued",
      });
    }
    setSelectedSourceId(sourceId);
    setSelectedPath(normalizedPath);
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

  return (
    <div className="grid h-svh overflow-hidden grid-rows-[minmax(0,45%)_minmax(0,1fr)] md:grid-rows-none md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-hidden">
        <h1 className="text-lg font-semibold tracking-tight px-4 pt-4">FPSR Demo</h1>

        <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
          <div className="flex flex-col gap-4 py-4 pl-4 pr-3">
            <section className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">Demos</p>
              <SidebarTree
                sources={sampleSources}
                selectedSourceId={selectedSourceId}
                selectedPath={selectedPath}
                renderProgress={renderProgress}
                onSelect={onTreeSelect}
              />
            </section>

            <section className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">Tests</p>
              <SidebarTree
                sources={testSources}
                selectedSourceId={selectedSourceId}
                selectedPath={selectedPath}
                renderProgress={renderProgress}
                onSelect={onTreeSelect}
              />
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <p className="min-w-0 flex-1 text-muted-foreground text-sm">Custom</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Paste blueprint string"
                  onClick={() => void handlePaste()}
                >
                  <ClipboardIcon />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                    <EllipsisVerticalIcon />
                    <span className="sr-only">Custom options</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={() => {
                          setManualDraft("");
                          setManualOpen(true);
                        }}
                      >
                        Enter manually
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={customSources.length === 0}
                        onClick={() => void clearAllCustoms()}
                      >
                        Delete all
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <SidebarTree
                sources={customSources}
                selectedSourceId={selectedSourceId}
                selectedPath={selectedPath}
                renderProgress={renderProgress}
                onSelect={onTreeSelect}
              />
            </section>
          </div>
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

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card border ml-2 mr-3 my-3 rounded-xl">
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
          className="flex min-h-0 flex-1 flex-col border-t"
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

          <TabsContent value="compare" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tab === "compare" && (
              <ScrollArea className="min-h-0 flex-1">
                <ComparePane caseName={isGoldenSelected ? selectedSourceId : null} />
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="process" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tab === "process" && <ProcessPane doc={activeDoc} blueprint={selectedBlueprint} />}
          </TabsContent>

          <TabsContent value="performance" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tab === "performance" && <PerformancePane report={perfReport} />}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
