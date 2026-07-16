import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type Blueprint, type BlueprintDocument, type DrawList, planDrawList } from "fpsr";
import { CircleCheck, CircleSlash } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getAdapterChecks } from "./adapter-checks";
import { formatDrawList } from "./format-draw-list";
import { JsonViewer } from "./json-viewer";
import { cn } from "./lib/utils";
import { viewerAssets } from "./viewer-assets";

function ProcessPanel({
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
}) {
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
        <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      )}
    </div>
  );
}

function ChecksPanel({ blueprint }: { blueprint: Blueprint | null }) {
  const checks = useMemo(() => getAdapterChecks(blueprint), [blueprint]);

  return (
    <ul className="flex flex-col gap-1 p-3">
      {checks.map(({ id, used }) => (
        <li key={id} className="flex items-center gap-2 text-sm">
          {used ? (
            <CircleCheck className="size-4 shrink-0 text-green-600 dark:text-green-500" />
          ) : (
            <CircleSlash className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className={used ? "text-foreground" : "text-muted-foreground"}>{id}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProcessPane({
  doc,
  blueprint,
}: {
  doc: BlueprintDocument | null;
  blueprint: Blueprint | null;
}) {
  const planGenRef = useRef(0);

  const [drawList, setDrawList] = useState<DrawList | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [drawLoading, setDrawLoading] = useState(false);
  const [organizeDrawCommands, setOrganizeDrawCommands] = useState(true);

  const decodedValue = blueprint ?? doc;
  const drawValue = useMemo(() => {
    if (drawError || !drawList) return null;
    return organizeDrawCommands ? formatDrawList(drawList) : drawList;
  }, [drawError, drawList, organizeDrawCommands]);

  useEffect(() => {
    if (!blueprint) {
      setDrawList(null);
      setDrawError(null);
      setDrawLoading(false);
      return;
    }

    const gen = ++planGenRef.current;
    setDrawLoading(true);
    setDrawError(null);
    setDrawList(null);

    void (async () => {
      try {
        const db = await viewerAssets.loadRenderDb();
        if (gen !== planGenRef.current) return;

        const list = planDrawList(blueprint, db, { altMode: true });
        if (gen !== planGenRef.current) return;

        setDrawList(list);
      } catch (e) {
        if (gen !== planGenRef.current) return;
        const message = e instanceof Error ? e.message : "Planning failed";
        setDrawError(message);
        setDrawList(null);
      } finally {
        if (gen === planGenRef.current) {
          setDrawLoading(false);
        }
      }
    })();
  }, [blueprint]);

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 gap-0.5">
      <ResizablePanel defaultSize={40} minSize={160} className="min-h-0">
        <ProcessPanel title="Decoded JSON" index={0} maxIndex={2} scrollContent={false}>
          <JsonViewer value={decodedValue} />
        </ProcessPanel>
      </ResizablePanel>

      <ResizableHandle withHandle handleOnly disableDoubleClick />

      <ResizablePanel defaultSize={40} minSize={160} className="min-h-0">
        <ProcessPanel
          title="Draw commands"
          index={1}
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
          {drawLoading && <p className="p-4 font-mono text-xs text-muted-foreground">Planning…</p>}
          {!drawLoading && drawError && (
            <p className="p-4 font-mono text-xs text-destructive">{drawError}</p>
          )}
          {!drawLoading && !drawError && <JsonViewer value={drawValue} />}
        </ProcessPanel>
      </ResizablePanel>

      <ResizableHandle withHandle handleOnly disableDoubleClick />

      <ResizablePanel defaultSize={20} minSize={160} className="min-h-0">
        <ProcessPanel title="Checks" index={2} maxIndex={2}>
          <ChecksPanel blueprint={blueprint} />
        </ProcessPanel>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
