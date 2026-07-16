import { cn } from "@/lib/utils";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import * as React from "react";
const ScrollAreaRoot = React.forwardRef<HTMLDivElement, ScrollAreaPrimitive.Root.Props>(
  ({ className, ...props }, ref) => (
    <ScrollAreaPrimitive.Root
      ref={ref}
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    />
  ),
);
const ScrollAreaViewport = React.forwardRef<HTMLDivElement, ScrollAreaPrimitive.Viewport.Props>(
  ({ className, ...props }, ref) => (
    <ScrollAreaPrimitive.Viewport
      ref={ref}
      data-slot="scroll-area-viewport"
      className={cn(
        "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
        className,
      )}
      {...props}
    />
  ),
);
const ScrollAreaCorner = (props: ScrollAreaPrimitive.Corner.Props) => {
  return <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" {...props} />;
};
const ScrollAreaContent = React.forwardRef<HTMLDivElement, ScrollAreaPrimitive.Content.Props>(
  ({ className, ...props }, ref) => (
    <ScrollAreaPrimitive.Content
      ref={ref}
      data-slot="scroll-area-content"
      className={cn(className)}
      {...props}
    />
  ),
);
const ScrollArea = ({
  className,
  viewportClassName,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string;
}) => {
  return (
    <ScrollAreaRoot className={className} {...props}>
      <ScrollAreaViewport className={viewportClassName}>
        {/* Content observes size changes so overflow/scrollbar state stays in sync. */}
        <ScrollAreaContent>{children}</ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaCorner />
    </ScrollAreaRoot>
  );
};
const ScrollBar = ({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) => {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
};
export {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
};
