import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const PaneMessage = ({
  children,
  className,
  loading = false,
}: {
  children: ReactNode;
  className?: string;
  loading?: boolean;
}) => {
  return (
    <div className={cn("flex min-h-32 flex-1 items-center justify-center p-4", className)}>
      <div className="flex max-w-lg items-center gap-2 rounded-lg border bg-muted/20 px-6 py-8 text-center text-sm text-muted-foreground">
        {loading && <Spinner className="shrink-0" />}
        <span>{children}</span>
      </div>
    </div>
  );
};
