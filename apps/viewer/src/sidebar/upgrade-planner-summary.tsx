import { formatByteSize, formatGameVersion } from "@/blueprint/blueprint-meta";
import { CopyableBlueprintIcons } from "@/blueprint/copyable-blueprint-icons";
import { FactorioRichText } from "@/blueprint/factorio-rich-text";
import { asUpgradePlanner, encode, upgradePlannerIcons } from "fpsr";

export const UpgradePlannerSummary = ({
  planner,
  sourceBytes,
  sourceString,
}: {
  planner: Record<string, unknown>;
  /** Exact encoded source size when this is a top-level upgrade planner document. */
  sourceBytes?: number;
  /** Original Factorio string when this is a top-level upgrade planner document. */
  sourceString?: string;
}) => {
  const typed = asUpgradePlanner(planner);
  const version = typeof typed.version === "number" ? typed.version : undefined;
  const byteSize = formatByteSize(sourceBytes ?? encode({ upgrade_planner: planner }).length);
  const getPlannerString = () => sourceString ?? encode({ upgrade_planner: planner });
  const icons = upgradePlannerIcons(planner);

  return (
    <div className="flex min-w-0 shrink-0 gap-4 overflow-hidden p-4">
      <CopyableBlueprintIcons
        icons={icons}
        backgroundKey="item/upgrade-planner"
        getBlueprintString={getPlannerString}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-medium text-lg text-foreground">
            <FactorioRichText text={typed.label} fallback="<Unnamed upgrade planner>" size="lg" />
          </h2>
          <dd className="break-words text-muted-foreground text-sm">
            <FactorioRichText text={typed.description} fallback="No description" size="sm" />
          </dd>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {version !== undefined ? (
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="tabular-nums text-foreground">{formatGameVersion(version)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">Byte size</dt>
            <dd className="tabular-nums text-foreground">{byteSize}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
};
