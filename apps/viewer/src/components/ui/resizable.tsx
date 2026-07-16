import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";
const ResizablePanelGroup = ({ className, ...props }: ResizablePrimitive.GroupProps) => {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
};
const ResizablePanel = ({ ...props }: ResizablePrimitive.PanelProps) => {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
};
const ResizableHandle = ({
  withHandle,
  handleOnly,
  className,
  disableDoubleClick,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
  /** Restrict dragging to the visible grip instead of the full separator edge. */
  handleOnly?: boolean;
}) => {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      disableDoubleClick={disableDoubleClick}
      className={cn(
        "relative flex shrink-0 items-center justify-center bg-transparent ring-offset-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden",
        handleOnly
          ? "w-2 [&[aria-orientation=vertical]>div]:h-10 [&[aria-orientation=vertical]>div]:w-1.5 [&[aria-orientation=vertical]>div]:cursor-col-resize [&[aria-orientation=horizontal]>div]:h-1.5 [&[aria-orientation=horizontal]>div]:w-10 [&[aria-orientation=horizontal]>div]:cursor-row-resize"
          : "w-px bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div
          className={cn(
            "z-10 shrink-0 rounded-lg bg-border",
            handleOnly ? undefined : "flex h-6 w-1",
          )}
        />
      )}
    </ResizablePrimitive.Separator>
  );
};
export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
