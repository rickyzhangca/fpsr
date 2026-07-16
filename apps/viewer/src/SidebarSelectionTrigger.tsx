import { Button } from "@/components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { FactorioRichText } from "./FactorioRichText";
import type { SidebarSelectionInfo } from "./sidebarSelection";
import { TreeItemKindIcon } from "./SidebarTree";

export function SidebarSelectionTrigger({
  selection,
  ...props
}: {
  selection: SidebarSelectionInfo;
} & ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      className="h-auto w-full justify-between gap-2 px-2 py-1.5"
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <TreeItemKindIcon kind={selection.kind} icons={selection.icons} />
        <span className="min-w-0 truncate text-left">
          <FactorioRichText text={selection.label} size="sm" />
        </span>
      </span>
      <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
    </Button>
  );
}
