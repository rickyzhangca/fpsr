import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import type * as React from "react";

function Tree({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tree"
      role="tree"
      className={cn("flex flex-col gap-0.5 outline-none", className)}
      {...props}
    />
  );
}

function TreeItem({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tree-item"
      className={cn("relative flex w-full items-center", className)}
      {...props}
    />
  );
}

function TreeItemButton({
  className,
  indent = 0,
  ...props
}: React.ComponentProps<"button"> & { indent?: number }) {
  return (
    <button
      data-slot="tree-item-button"
      type="button"
      style={{ paddingLeft: indent }}
      className={cn(
        "flex h-12 w-full items-center gap-1 rounded px-2 text-left text-sm font-normal outline-none select-none",
        "hover:bg-muted hover:text-foreground",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        "data-[muted=true]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TreeExpandIcon({ expanded, className }: { expanded?: boolean; className?: string }) {
  return (
    <ChevronRight
      data-slot="tree-expand-icon"
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground transition-transform",
        expanded && "rotate-90",
        className,
      )}
    />
  );
}

function TreeItemIconSlot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tree-item-icon"
      className={cn("flex size-3.5 shrink-0 items-center justify-center", className)}
      {...props}
    />
  );
}

export { Tree, TreeExpandIcon, TreeItem, TreeItemButton, TreeItemIconSlot };
