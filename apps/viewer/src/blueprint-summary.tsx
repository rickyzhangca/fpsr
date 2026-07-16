import type { Blueprint } from "fpsr";
import { memo, useMemo } from "react";
import { BlueprintComponents } from "./blueprint-components";
import { BlueprintIcons } from "./blueprint-icons";
import {
  encodedByteSize,
  formatByteSize,
  formatGameVersion,
  formatSnapping,
} from "./blueprint-meta";
import { FactorioRichText } from "./factorio-rich-text";

export const BlueprintSummary = memo(function BlueprintSummary({
  blueprint,
  tileSize,
  sourceBytes,
}: {
  blueprint: Blueprint;
  tileSize: string;
  /** Exact encoded source size when this is a bare blueprint document. */
  sourceBytes?: number;
}) {
  const byteSize = useMemo(
    () => formatByteSize(sourceBytes ?? encodedByteSize(blueprint)),
    [blueprint, sourceBytes],
  );

  return (
    <div className="flex shrink-0 gap-4 p-4">
      <BlueprintIcons icons={blueprint.icons} />

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium text-lg text-foreground">
            <FactorioRichText text={blueprint.label} fallback="<Unnamed blueprint>" size="lg" />
          </h2>
          <dd className="text-muted-foreground text-sm">
            <FactorioRichText text={blueprint.description} fallback="No description" size="sm" />
          </dd>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Version</dt>
            <dd className="tabular-nums text-foreground">{formatGameVersion(blueprint.version)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="tabular-nums text-foreground">{tileSize}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Snapping</dt>
            <dd className="text-foreground">{formatSnapping(blueprint)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Byte size</dt>
            <dd className="tabular-nums text-foreground">{byteSize}</dd>
          </div>
        </dl>

        <div className="shrink-0 pt-1">
          <BlueprintComponents entities={blueprint.entities} tiles={blueprint.tiles} />
        </div>
      </div>
    </div>
  );
});
