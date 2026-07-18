import type { BlueprintIconVariant, Icon } from "fpsr";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { BlueprintIcons } from "./blueprint-icons";
import { Button } from "@/components/ui/button";

export const CopyableBlueprintIcons = ({
  icons,
  size,
  backgroundKey,
  variant,
  getBlueprintString,
}: {
  icons?: Icon[];
  size?: number;
  backgroundKey?: string;
  variant?: BlueprintIconVariant;
  getBlueprintString: () => string;
}) => {
  const handleCopy = async () => {
    try {
      const text = getBlueprintString();
      await navigator.clipboard.writeText(text);
      toast.success("Blueprint string copied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Copy failed");
    }
  };

  return (
    <div className="group flex h-fit relative w-fit">
      <BlueprintIcons icons={icons} size={size} backgroundKey={backgroundKey} variant={variant} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Copy blueprint string"
          onClick={() => void handleCopy()}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  );
};
