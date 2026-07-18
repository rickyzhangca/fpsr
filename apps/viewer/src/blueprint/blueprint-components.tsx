import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { viewerAssets } from "@/shell/viewer-assets";
import { countBlueprintComponents, type Blueprint, type RenderDb } from "fpsr";
import { useEffect, useState } from "react";
import { FactorioItemIcon } from "./factorio-item-icon";

export const BlueprintComponents = ({ blueprint }: { blueprint: Blueprint }) => {
  const [db, setDb] = useState<RenderDb | undefined>();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const renderDb = await viewerAssets.loadRenderDb();
      if (!cancelled) setDb(renderDb);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const counts = db ? countBlueprintComponents(blueprint, db) : undefined;
  return (
    <div className="w-fit rounded-lg flex flex-col overflow-hidden border bg-card">
      <p className="px-2 py-1 border-b text-sm">Components</p>
      {counts === undefined ? null : counts.length === 0 ? (
        <p className="p-2 text-muted-foreground">No components found</p>
      ) : (
        <ul className="flex flex-wrap gap-1 p-1.5">
          {counts.map(({ name, count }) => (
            <li key={name}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="relative overflow-hidden flex size-11 items-center justify-center rounded-sm bg-linear-to-b to-20% from-foreground/25 to-foreground/15 shadow-[inset_1px_1px_2px_rgba(0,0,0,1)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label={name}
                    />
                  }
                >
                  <FactorioItemIcon
                    iconKey={[`item/${name}`, `entity/${name}`]}
                    iconSize={32}
                    silhouette={{ dilateRadius: 4, blurRadius: 12, intensity: 0.64 }}
                  />
                  <span className="pointer-events-none absolute right-0.5 -bottom-0.5 text-[13px] font-medium tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
                    {count}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{name}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
