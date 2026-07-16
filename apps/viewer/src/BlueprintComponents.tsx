import type { Blueprint } from "fpsr";
import { useEffect, useMemo, useState } from "react";
import { countBlueprintComponentsByName } from "./blueprintMeta";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { FactorioItemIcon } from "./FactorioItemIcon";
import { viewerAssets } from "./viewerAssets";

export function BlueprintComponents({
  entities,
  tiles,
}: {
  entities: Blueprint["entities"];
  tiles?: Blueprint["tiles"];
}) {
  const [tileItemByName, setTileItemByName] = useState<Record<string, string> | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await viewerAssets.loadRenderDb();
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [tileName, def] of Object.entries(db.tiles)) {
        if (def.item) map[tileName] = def.item;
      }
      setTileItemByName(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(
    () => countBlueprintComponentsByName(entities, tiles, tileItemByName),
    [entities, tiles, tileItemByName],
  );

  return (
    <div className="w-fit rounded-lg flex flex-col overflow-hidden border bg-card">
      <p className="px-2 py-1 border-b text-sm">Components</p>
      {counts.length === 0 ? (
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
}
