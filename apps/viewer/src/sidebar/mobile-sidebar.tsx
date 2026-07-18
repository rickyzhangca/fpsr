import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReactNode } from "react";

export const MobileSidebar = ({
  children,
  open,
  onOpenChange,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle swipeDirection="down">
      <DrawerContent className="[--drawer-content-height:min(70vh,600px)]">
        <DrawerHeader>
          <DrawerTitle>Blueprints</DrawerTitle>
          <DrawerDescription className="sr-only">
            Select a blueprint or blueprint book
          </DrawerDescription>
        </DrawerHeader>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
          {children}
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
};
