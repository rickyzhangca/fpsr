import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JsonViewer } from "@/json/json-viewer";
import { cn } from "@/lib/utils";
import type { PerfReport } from "@/performance/perf-report";
import { formatDrawList } from "@/preview/format-draw-list";
import { planPreviewWithDiagnostics } from "@/preview/preview-renderer";
import type { PreviewRenderProgress } from "@/preview/render-worker-protocol";
import { previewPreferencesAtom, processPreferencesAtom } from "@/shell/viewer-preferences";
import type { Blueprint, BlueprintDocument, DecodeStats, DrawList } from "@rickyzhangca/fpsr";
import { useAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { getAdapterChecks } from "./adapter-checks";
import { createPipelineReceipt } from "./pipeline-receipt";
import { PipelineReceiptPanel } from "./pipeline-receipt-panel";
import type { PlanDiagnostics } from "./plan-diagnostics";
const ProcessPanel = ({
  title,
  index,
  maxIndex,
  headerRight,
  scrollContent = true,
  children,
}: {
  title: string;
  index: number;
  maxIndex: number;
  headerRight?: ReactNode;
  scrollContent?: boolean;
  children: ReactNode;
}) => {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden border-t",
        index === 0 && "border-r",
        index === maxIndex && "border-l",
        index !== 0 && index !== maxIndex && "border-x",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {headerRight}
      </div>
      {scrollContent ? (
        <ScrollArea className="h-full min-h-0 flex-1" viewportClassName="scroll-fade">
          {children}
        </ScrollArea>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      )}
    </div>
  );
};
export const ProcessPane = ({
  doc,
  blueprint,
  blueprintPath,
  decodeStats,
  perfReport,
  renderProgress,
  renderError,
}: {
  doc: BlueprintDocument | null;
  blueprint: Blueprint | null;
  blueprintPath: number[] | null;
  decodeStats: DecodeStats | null;
  perfReport: PerfReport | null;
  renderProgress: PreviewRenderProgress | null;
  renderError: string | null;
}) => {
  const planGenRef = useRef(0);
  const [drawList, setDrawList] = useState<DrawList | null>(null);
  const [planDiagnostics, setPlanDiagnostics] = useState<PlanDiagnostics | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [drawLoading, setDrawLoading] = useState(false);
  const [processPreferences, setProcessPreferences] = useAtom(processPreferencesAtom);
  const [previewPreferences] = useAtom(previewPreferencesAtom);
  const { organizeDrawCommands, panelLayout } = processPreferences;
  const setOrganizeDrawCommands = (value: boolean) => {
    setProcessPreferences((previous) => ({ ...previous, organizeDrawCommands: value }));
  };
  const decodedValue = blueprint ?? doc;
  const drawValue =
    drawError || !drawList ? null : organizeDrawCommands ? formatDrawList(drawList) : drawList;
  useEffect(() => {
    if (!blueprint) {
      setDrawList(null);
      setPlanDiagnostics(null);
      setDrawError(null);
      setDrawLoading(false);
      return;
    }
    const gen = ++planGenRef.current;
    setDrawLoading(true);
    setDrawError(null);
    setDrawList(null);
    setPlanDiagnostics(null);
    void (async () => {
      try {
        const result = await planPreviewWithDiagnostics(blueprint, {
          altMode: previewPreferences.altMode,
        });
        if (gen !== planGenRef.current) return;
        setDrawList(result.drawList);
        setPlanDiagnostics(result.diagnostics);
      } catch (e) {
        if (gen !== planGenRef.current) return;
        const message = e instanceof Error ? e.message : "Planning failed";
        setDrawError(message);
        setDrawList(null);
        setPlanDiagnostics(null);
      } finally {
        if (gen === planGenRef.current) {
          setDrawLoading(false);
        }
      }
    })();
  }, [blueprint, previewPreferences.altMode]);
  const receipt = createPipelineReceipt({
    blueprint,
    blueprintPath,
    decodeStats,
    adapterChecks: getAdapterChecks(blueprint),
    diagnostics: planDiagnostics,
    planLoading: drawLoading,
    planError: drawError,
    perfReport,
    renderProgress,
    renderError,
  });
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ResizablePanelGroup
        id="process-panels"
        orientation="horizontal"
        defaultLayout={panelLayout ?? undefined}
        onLayoutChanged={(layout, meta) => {
          if (meta.isUserInteraction) {
            setProcessPreferences((previous) => ({ ...previous, panelLayout: layout }));
          }
        }}
        className="h-full min-h-0 min-w-[540px] flex-1 gap-0.5"
      >
        <ResizablePanel id="checks" defaultSize="33" minSize={200} className="min-h-0">
          <ProcessPanel title="Pipeline" index={0} maxIndex={2}>
            <PipelineReceiptPanel receipt={receipt} />
          </ProcessPanel>
        </ResizablePanel>

        <ResizableHandle className="items-start" withHandle handleOnly disableDoubleClick />

        <ResizablePanel id="decoded" defaultSize="33" minSize={160} className="min-h-0">
          <ProcessPanel title="Decoded JSON" index={1} maxIndex={2} scrollContent={false}>
            <JsonViewer value={decodedValue} />
          </ProcessPanel>
        </ResizablePanel>

        <ResizableHandle className="items-start" withHandle handleOnly disableDoubleClick />

        <ResizablePanel id="draw" defaultSize="34" minSize={160} className="min-h-0">
          <ProcessPanel
            title="Draw commands"
            index={2}
            maxIndex={2}
            scrollContent={false}
            headerRight={
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="organize-draw-commands"
                  checked={organizeDrawCommands}
                  onCheckedChange={(checked) => setOrganizeDrawCommands(checked)}
                />
                <Label
                  htmlFor="organize-draw-commands"
                  className="text-xs font-normal text-muted-foreground"
                >
                  Organize
                </Label>
              </div>
            }
          >
            {drawLoading && (
              <p className="p-4 font-mono text-xs text-muted-foreground">Planning…</p>
            )}
            {!drawLoading && drawError && (
              <p className="p-4 font-mono text-xs text-destructive">{drawError}</p>
            )}
            {!drawLoading && !drawError && <JsonViewer value={drawValue} />}
          </ProcessPanel>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
