import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Minus, Plus, RotateCcw } from "lucide-react";

export const ViewerToolbar = ({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
}) => {
  return (
    <div
      data-no-pan
      className="pointer-events-auto absolute bottom-3 left-3 z-10 rounded-lg bg-background/90 shadow-sm backdrop-blur-sm"
    >
      <ButtonGroup>
        <Button variant="outline" size="icon" onClick={onZoomOut} aria-label="Zoom out">
          <Minus />
        </Button>
        <ButtonGroupText className="bg-primary-background border min-w-10 text-xs tabular-nums">
          {(zoom * 100).toFixed(0)}%
        </ButtonGroupText>
        <Button variant="outline" size="icon" onClick={onZoomIn} aria-label="Zoom in">
          <Plus />
        </Button>
        <Button variant="outline" size="icon" onClick={onReset} aria-label="Reset view">
          <RotateCcw />
        </Button>
      </ButtonGroup>
    </div>
  );
};
