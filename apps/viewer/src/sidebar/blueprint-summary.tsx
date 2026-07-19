import { BlueprintComponents } from "@/blueprint/blueprint-components";
import {
  encodedByteSize,
  formatByteSize,
  formatGameVersion,
  formatSnapping,
} from "@/blueprint/blueprint-meta";
import { CopyableBlueprintIcons } from "@/blueprint/copyable-blueprint-icons";
import { FactorioRichText } from "@/blueprint/factorio-rich-text";
import { Button } from "@/components/ui/button";
import { summaryExpandedAtom } from "@/shell/viewer-preferences";
import { encode, type Blueprint } from "@rickyzhangca/fpsr";
import { useAtom } from "jotai";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

export const BlueprintSummary = ({
  blueprint,
  tileSize,
  sourceBytes,
  sourceString,
}: {
  blueprint: Blueprint;
  tileSize: string;
  /** Exact encoded source size when this is a bare blueprint document. */
  sourceBytes?: number;
  /** Original Factorio string when this is a top-level blueprint document. */
  sourceString?: string;
}) => {
  const [expanded, setExpanded] = useAtom(summaryExpandedAtom);
  const byteSize = formatByteSize(sourceBytes ?? encodedByteSize(blueprint));
  const getBlueprintString = () => sourceString ?? encode({ blueprint });

  return (
    <div className="relative w-full max-w-full min-w-0 shrink-0 overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 z-10"
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse summary" : "Expand summary"}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </Button>

      {expanded ? (
        <div className="flex min-w-0 gap-4 p-4 pr-12">
          <CopyableBlueprintIcons icons={blueprint.icons} getBlueprintString={getBlueprintString} />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="min-w-0">
              <h2 className="break-words font-medium text-lg text-foreground">
                <FactorioRichText text={blueprint.label} fallback="<Unnamed blueprint>" size="lg" />
              </h2>
              <dd className="break-words text-muted-foreground text-sm">
                <FactorioRichText
                  text={blueprint.description}
                  fallback="No description"
                  size="sm"
                />
              </dd>
            </div>

            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Version</dt>
                <dd className="tabular-nums text-foreground">
                  {formatGameVersion(blueprint.version)}
                </dd>
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
              <BlueprintComponents blueprint={blueprint} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex w-full max-w-full min-w-0 items-center gap-3 overflow-hidden p-3 pr-12">
          <div className="shrink-0">
            <CopyableBlueprintIcons
              icons={blueprint.icons}
              size={40}
              getBlueprintString={getBlueprintString}
            />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <h2 className="font-medium text-foreground">
              <FactorioRichText
                text={blueprint.label}
                fallback="<Unnamed blueprint>"
                className="truncate"
              />
            </h2>
            <dd className="text-muted-foreground text-sm">
              <FactorioRichText
                text={blueprint.description}
                fallback="No description"
                size="sm"
                className="truncate"
              />
            </dd>
          </div>
        </div>
      )}
    </div>
  );
};
