import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PipelineFinding,
  PipelineReceipt,
  PipelineStage,
  PipelineStatus,
} from "./pipeline-receipt";

const StatusIcon = ({ status }: { status: PipelineStatus }) => {
  const className = cn(
    "size-4 shrink-0",
    status === "passed" && "stroke-green-500",
    status === "running" && "animate-spin",
    status === "failed" && "text-destructive",
    status === "not-needed" && "opacity-40",
    status !== "failed" && status !== "not-needed" && "text-primary",
  );
  switch (status) {
    case "passed":
      return <CircleCheck aria-hidden className={className} />;
    case "running":
      return <Spinner className={className} />;
    case "warning":
      return <TriangleAlert aria-hidden className={className} />;
    case "failed":
      return <CircleX aria-hidden className={className} />;
    case "not-needed":
      return <CircleMinus aria-hidden className={className} />;
  }
};

const StageRow = ({ stage, compact = false }: { stage: PipelineStage; compact?: boolean }) => {
  return (
    <li className="flex min-w-0 items-start gap-2 py-1.5">
      <StatusIcon status={stage.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          className={cn(
            "flex min-w-0 text-xs",
            compact ? "items-baseline justify-between gap-2" : "flex-col items-start gap-0.5",
          )}
        >
          <span className={cn("font-medium text-foreground", compact && "truncate")}>
            {stage.label}
          </span>
          <span
            className={cn(
              "text-xs tabular-nums",
              compact ? "shrink-0 text-right" : "text-left",
              stage.status === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {stage.value}
          </span>
        </div>
        {!compact && <p className="text-xs text-muted-foreground">{stage.detail}</p>}
      </div>
    </li>
  );
};

const Section = ({
  title,
  stages,
  compact = false,
}: {
  title: string;
  stages: PipelineStage[];
  compact?: boolean;
}) => {
  if (stages.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="flex flex-col">
        {stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} compact={compact} />
        ))}
      </ul>
    </section>
  );
};

const Finding = ({ finding }: { finding: PipelineFinding }) => {
  return (
    <Alert variant={finding.destructive ? "destructive" : "default"}>
      {finding.destructive ? <CircleX /> : <TriangleAlert />}
      <AlertTitle>{finding.title}</AlertTitle>
      <AlertDescription>{finding.detail}</AlertDescription>
    </Alert>
  );
};

export const PipelineReceiptPanel = ({ receipt }: { receipt: PipelineReceipt }) => {
  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex gap-2">
        <StatusIcon status={receipt.summary.status} />
        <p className="flex flex-col gap-0.5">
          <span className="font-medium text-xs">{receipt.summary.title}</span>
          <span className="text-xs text-muted-foreground">{receipt.summary.detail}</span>
          <span>
            {receipt.tags.length > 0 && (
              <p className="text-xs leading-4 text-muted-foreground">{receipt.tags.join(" + ")}</p>
            )}
          </span>
        </p>
      </div>

      <Section title="Run" stages={receipt.stages} />

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Findings</p>
        {receipt.findings.length === 0 ? (
          <p className="text-xs text-muted-foreground">N/A</p>
        ) : (
          <>
            {receipt.findings.map((finding) => (
              <Finding key={finding.id} finding={finding} />
            ))}
          </>
        )}
      </section>

      <Section title="Verification" stages={receipt.verifications} compact />
      <Section title="Compatibility" stages={receipt.compatibility} compact />
    </div>
  );
};
