import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActiveRenderProgress } from "@/preview/render-progress-state";
import { ClipboardIcon, EllipsisVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  type SidebarSelectableKind,
  type SidebarSource,
  type SidebarSourceId,
  SidebarTree,
} from "./sidebar-tree";

const SidebarTreeScroll = ({ children }: { children: ReactNode }) => {
  return (
    <ScrollArea className="min-w-0 w-full" viewportClassName="scroll-fade">
      {children}
    </ScrollArea>
  );
};

export const SidebarPanels = ({
  sampleSources,
  testSources,
  customSources,
  selectedSourceId,
  selectedPath,
  selectedKind,
  renderProgress,
  onSelect,
  onPaste,
  onManualOpen,
  onClearAllCustoms,
}: {
  sampleSources: SidebarSource[];
  testSources: SidebarSource[];
  customSources: SidebarSource[];
  selectedSourceId: SidebarSourceId;
  selectedPath: number[] | null;
  selectedKind: SidebarSelectableKind;
  renderProgress: ActiveRenderProgress | null;
  onSelect: (sourceId: SidebarSourceId, path: number[], kind: SidebarSelectableKind) => void;
  onPaste: () => void;
  onManualOpen: () => void;
  onClearAllCustoms: () => void;
}) => {
  return (
    <div className="flex min-w-0 w-full flex-col gap-4 py-4 pl-4 pr-3">
      <section className="flex min-w-0 flex-col gap-2">
        <p className="text-muted-foreground text-sm">Demos</p>
        <SidebarTreeScroll>
          <SidebarTree
            sectionId="demos"
            sources={sampleSources}
            selectedSourceId={selectedSourceId}
            selectedPath={selectedPath}
            selectedKind={selectedKind}
            renderProgress={renderProgress}
            onSelect={onSelect}
          />
        </SidebarTreeScroll>
      </section>

      <section className="flex min-w-0 flex-col gap-2">
        <p className="text-muted-foreground text-sm">Tests</p>
        <SidebarTreeScroll>
          <SidebarTree
            sectionId="tests"
            sources={testSources}
            selectedSourceId={selectedSourceId}
            selectedPath={selectedPath}
            selectedKind={selectedKind}
            renderProgress={renderProgress}
            onSelect={onSelect}
          />
        </SidebarTreeScroll>
      </section>

      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 text-muted-foreground text-sm">Custom</p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Paste blueprint string"
            onClick={onPaste}
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
                <DropdownMenuItem onClick={onManualOpen}>Enter manually</DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={customSources.length === 0}
                  onClick={onClearAllCustoms}
                >
                  Delete all
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <SidebarTreeScroll>
          <SidebarTree
            sectionId="custom"
            sources={customSources}
            selectedSourceId={selectedSourceId}
            selectedPath={selectedPath}
            selectedKind={selectedKind}
            renderProgress={renderProgress}
            onSelect={onSelect}
          />
        </SidebarTreeScroll>
      </section>
    </div>
  );
};
