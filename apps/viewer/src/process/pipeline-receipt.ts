import type { Blueprint, DecodeStats } from "@rickyzhangca/fpsr";
import type { AdapterCheck } from "./adapter-checks";
import type { PerfReport } from "@/performance/perf-report";
import type { PlanDiagnostics } from "./plan-diagnostics";
import type { PreviewRenderProgress } from "@/preview/render-worker-protocol";
import {
  assetsStage,
  compatibilityStage,
  formatBytes,
  formatEntityCount,
  paintStage,
  planStage,
  resolveStage,
  selectionStage,
  sourceStage,
  unsupportedDetail,
  verificationStages,
} from "./receipt-stages";

export type PipelineStatus = "passed" | "running" | "warning" | "failed" | "not-needed";

export interface PipelineStage {
  id: string;
  label: string;
  status: PipelineStatus;
  value: string;
  detail: string;
}

export interface PipelineFinding {
  id: string;
  title: string;
  detail: string;
  destructive?: boolean;
}

export interface PipelineReceipt {
  summary: {
    title: string;
    detail: string;
    status: PipelineStatus;
    progress?: number;
    progressLabel?: string;
  };
  stages: PipelineStage[];
  compatibility: PipelineStage[];
  findings: PipelineFinding[];
  verifications: PipelineStage[];
  tags: string[];
}

export interface PipelineReceiptInput {
  blueprint: Blueprint | null;
  blueprintPath: number[] | null;
  decodeStats: DecodeStats | null;
  adapterChecks: AdapterCheck[];
  diagnostics: PlanDiagnostics | null;
  planLoading: boolean;
  planError: string | null;
  perfReport: PerfReport | null;
  renderProgress: PreviewRenderProgress | null;
  renderError: string | null;
}

export const createPipelineReceipt = (input: PipelineReceiptInput): PipelineReceipt => {
  const {
    blueprint,
    blueprintPath,
    decodeStats,
    adapterChecks,
    diagnostics,
    planLoading,
    planError,
    perfReport,
    renderProgress,
    renderError,
  } = input;
  if (!blueprint) {
    return {
      summary: {
        title: "Waiting for blueprint",
        detail: "Select a blueprint to inspect its path from string to pixels.",
        status: "not-needed",
      },
      stages: [],
      compatibility: [],
      findings: [],
      verifications: [],
      tags: [],
    };
  }

  const compatibility = compatibilityStage(blueprint, adapterChecks);
  const verifications = verificationStages(diagnostics);
  const findings: PipelineFinding[] = [];
  if (renderError) {
    findings.push({
      id: "render-error",
      title: "Render failed",
      detail: renderError,
      destructive: true,
    });
  } else if (planError) {
    findings.push({
      id: "plan-error",
      title: "Planning failed",
      detail: planError,
      destructive: true,
    });
  }
  for (const value of diagnostics?.entities.unsupported ?? []) {
    findings.push({
      id: `entity-${value.name}`,
      title: `Unsupported entity: ${value.name}`,
      detail: `${unsupportedDetail(value)} · rendered with the unsupported-entity marker`,
    });
  }
  for (const value of diagnostics?.tiles.unsupported ?? []) {
    findings.push({
      id: `tile-${value.name}`,
      title: `Unsupported tile: ${value.name}`,
      detail: `${unsupportedDetail(value)} · omitted from the draw list`,
    });
  }
  for (const check of verifications.filter((value) => value.status === "failed")) {
    findings.push({
      id: `check-${check.id}`,
      title: `${check.label} failed`,
      detail: check.detail,
      destructive: true,
    });
  }

  const isRunning =
    planLoading || (renderProgress != null && renderProgress.value < 100 && !renderError);
  const failed = Boolean(
    planError || renderError || findings.some((finding) => finding.destructive),
  );
  const warningCount = findings.filter((finding) => !finding.destructive).length;
  const commandCount = diagnostics?.drawList.commandCount ?? 0;
  const sourceSize = decodeStats?.inputChars ?? 0;
  const jsonSize = decodeStats?.inflatedBytes ?? decodeStats?.jsonChars ?? 0;
  const detail = `${formatBytes(sourceSize)} → ${formatBytes(jsonSize)} → ${commandCount.toLocaleString()} commands`;
  const summary = failed
    ? { title: "Pipeline failed", detail, status: "failed" as const }
    : isRunning
      ? {
          title: renderProgress?.label ?? "Planning blueprint",
          detail,
          status: "running" as const,
          progress: renderProgress?.value ?? 10,
          progressLabel: renderProgress?.label ?? "Planning",
        }
      : perfReport
        ? {
            title: warningCount > 0 ? "Rendered with warnings" : "Rendered",
            detail,
            status: warningCount > 0 ? ("warning" as const) : ("passed" as const),
          }
        : {
            title: warningCount > 0 ? "Render ready with warnings" : "Render ready",
            detail,
            status: warningCount > 0 ? ("warning" as const) : ("passed" as const),
          };

  const tags: string[] = [];
  if (adapterChecks.some((check) => check.used)) tags.push("Legacy migrated");
  if (
    (diagnostics?.entities.unsupported.length ?? 0) > 0 ||
    (diagnostics?.tiles.unsupported.length ?? 0) > 0
  ) {
    tags.push("Modded content");
  }
  if (perfReport) tags.push(perfReport.cold ? "cold render" : "warm render");
  if ((perfReport?.profile.output.megapixels ?? 0) >= 8) tags.push("large output");
  const entityCount = blueprint.entities?.length ?? 0;
  const wireCount = blueprint.wires?.length ?? 0;
  if (wireCount >= 10 && wireCount / Math.max(1, entityCount) >= 0.5) tags.push("circuit-heavy");

  return {
    summary,
    stages: [
      sourceStage(decodeStats),
      selectionStage(blueprint, blueprintPath),
      compatibility,
      resolveStage(diagnostics, planLoading, planError),
      planStage(diagnostics, planLoading, planError),
      assetsStage(perfReport, renderProgress, renderError),
      paintStage(perfReport, renderProgress, renderError),
    ],
    compatibility: adapterChecks.map((check) => ({
      id: check.id,
      label: check.label,
      status: check.used ? "passed" : "not-needed",
      value: check.used ? `${check.affectedEntities.toLocaleString()} applied` : "Not needed",
      detail: check.used
        ? `${formatEntityCount(check.affectedEntities)} changed by this compatibility transform.`
        : "The source already uses the current blueprint shape.",
    })),
    findings,
    verifications,
    tags,
  };
};
