import { decodeVersion, type Blueprint, type DecodeStats } from "fpsr";
import type { AdapterCheck } from "./adapter-checks";
import type { PerfReport } from "@/performance/perf-report";
import type { PlanDiagnostics, UnsupportedBlueprintContent } from "./plan-diagnostics";
import type { PreviewRenderProgress } from "@/preview/render-worker-protocol";
import type { PipelineStage } from "./pipeline-receipt";

const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1) return `${milliseconds.toFixed(2)}ms`;
  if (milliseconds < 10) return `${milliseconds.toFixed(1)}ms`;
  return `${Math.round(milliseconds)}ms`;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatGameVersion = (version: number): string => {
  const decoded = decodeVersion(version);
  return `${decoded.major}.${decoded.minor}.${decoded.patch}`;
};

const sumUnsupported = (values: readonly UnsupportedBlueprintContent[]): number => {
  return values.reduce((sum, value) => sum + value.count, 0);
};

export const formatEntityCount = (count: number): string => {
  return `${count.toLocaleString()} ${count === 1 ? "entity" : "entities"}`;
};

export const unsupportedDetail = (value: UnsupportedBlueprintContent): string => {
  const entityNumbers = value.entityNumbers?.slice(0, 5) ?? [];
  const suffix = entityNumbers.length > 0 ? ` · entities ${entityNumbers.join(", ")}` : "";
  return `${value.count.toLocaleString()} occurrence${value.count === 1 ? "" : "s"}${suffix}`;
};

export const sourceStage = (stats: DecodeStats | null): PipelineStage => {
  if (!stats) {
    return {
      id: "source",
      label: "Source string",
      status: "not-needed",
      value: "Decoded upstream",
      detail: "No source-level decode receipt is available for this selection.",
    };
  }
  if (stats.mode === "compressed") {
    const compressed = stats.compressedBytes ?? stats.inputChars;
    const inflated = stats.inflatedBytes ?? stats.jsonChars;
    return {
      id: "source",
      label: "String decoded",
      status: "passed",
      value: `${formatBytes(stats.inputChars)} → ${formatBytes(inflated)}`,
      detail: `${formatBytes(compressed)} zlib · ${stats.compressionRatio?.toFixed(1) ?? "—"}× expansion · base64 + zlib + JSON · ${formatDuration(stats.timings.totalMs)}`,
    };
  }
  return {
    id: "source",
    label: "JSON decoded",
    status: "passed",
    value: `${stats.jsonChars.toLocaleString()} chars`,
    detail: `Raw JSON input · ${formatDuration(stats.timings.totalMs)}`,
  };
};

export const selectionStage = (
  blueprint: Blueprint,
  blueprintPath: number[] | null,
): PipelineStage => {
  const path = blueprintPath?.length ? `Book / ${blueprintPath.join(" / ")}` : "Root blueprint";
  return {
    id: "selection",
    label: "Document selected",
    status: "passed",
    value: path,
    detail: `Factorio ${formatGameVersion(blueprint.version ?? 0)} · ${(blueprint.entities?.length ?? 0).toLocaleString()} entities · ${(blueprint.tiles?.length ?? 0).toLocaleString()} tiles · ${(blueprint.wires?.length ?? 0).toLocaleString()} wires`,
  };
};

export const compatibilityStage = (
  blueprint: Blueprint,
  checks: readonly AdapterCheck[],
): PipelineStage => {
  const applied = checks.filter((check) => check.used);
  const affected = applied.reduce((sum, check) => sum + check.affectedEntities, 0);
  if (applied.length === 0) {
    return {
      id: "compatibility",
      label: "Compatibility",
      status: "not-needed",
      value: `Native Factorio ${formatGameVersion(blueprint.version ?? 0)}`,
      detail: "No legacy transforms were needed",
    };
  }
  return {
    id: "compatibility",
    label: "Compatibility",
    status: "passed",
    value: `${formatEntityCount(affected)} converted`,
    detail: applied.map((check) => check.label).join(" · "),
  };
};

export const resolveStage = (
  diagnostics: PlanDiagnostics | null,
  loading: boolean,
  error: string | null,
): PipelineStage => {
  if (error) {
    return {
      id: "resolve",
      label: "Content resolved",
      status: "failed",
      value: "Planning failed",
      detail: error,
    };
  }
  if (loading || !diagnostics) {
    return {
      id: "resolve",
      label: "Content resolved",
      status: "running",
      value: "Inspecting prototypes",
      detail: "Matching blueprint entities and tiles to the render database.",
    };
  }
  const unsupported =
    sumUnsupported(diagnostics.entities.unsupported) +
    sumUnsupported(diagnostics.tiles.unsupported);
  return {
    id: "resolve",
    label: "Content resolved",
    status: unsupported > 0 ? "warning" : "passed",
    value: `${diagnostics.entities.resolved.toLocaleString()} / ${diagnostics.entities.total.toLocaleString()} entities`,
    detail: `${diagnostics.tiles.resolved.toLocaleString()} / ${diagnostics.tiles.total.toLocaleString()} tiles${unsupported > 0 ? ` · ${unsupported.toLocaleString()} fallbacks` : " · complete coverage"}`,
  };
};

export const planStage = (
  diagnostics: PlanDiagnostics | null,
  loading: boolean,
  error: string | null,
): PipelineStage => {
  if (error) {
    return {
      id: "plan",
      label: "Draw list built",
      status: "failed",
      value: "Unavailable",
      detail: error,
    };
  }
  if (loading || !diagnostics) {
    return {
      id: "plan",
      label: "Draw list built",
      status: "running",
      value: "Planning",
      detail: "Resolving geometry, overlays, layers, and stable paint order.",
    };
  }
  const kinds = Object.entries(diagnostics.drawList.byKind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind, count]) => `${count.toLocaleString()} ${kind}`)
    .join(" · ");
  return {
    id: "plan",
    label: "Draw list built",
    status: "passed",
    value: `${diagnostics.drawList.commandCount.toLocaleString()} commands`,
    detail: `${diagnostics.drawList.uniqueFrames.toLocaleString()} frames · ${diagnostics.drawList.uniqueLayers.toLocaleString()} layers${kinds ? ` · ${kinds}` : ""}`,
  };
};

export const assetsStage = (
  report: PerfReport | null,
  progress: PreviewRenderProgress | null,
  renderError: string | null,
): PipelineStage => {
  if (renderError) {
    return {
      id: "assets",
      label: "Assets ready",
      status: "failed",
      value: "Render interrupted",
      detail: renderError,
    };
  }
  if (report) {
    const atlases = report.profile.drawList.atlasIndices.length;
    const loads = report.profile.assets.filter((event) => !event.cached).length;
    const hits = report.profile.assets.filter((event) => event.cached).length;
    return {
      id: "assets",
      label: "Assets ready",
      status: "passed",
      value: `${atlases} / ${atlases} atlases`,
      detail: `${hits.toLocaleString()} cache hits · ${loads.toLocaleString()} fetched · ${formatDuration(report.profile.assetsMs)}`,
    };
  }
  return {
    id: "assets",
    label: "Assets ready",
    status: progress ? "running" : "not-needed",
    value: progress?.label ?? "Waiting for render",
    detail: "Referenced atlases are loaded only when the actual frame is rendered.",
  };
};

export const paintStage = (
  report: PerfReport | null,
  progress: PreviewRenderProgress | null,
  renderError: string | null,
): PipelineStage => {
  if (renderError) {
    return {
      id: "paint",
      label: "Frame painted",
      status: "failed",
      value: "Failed",
      detail: renderError,
    };
  }
  if (report) {
    const output = report.profile.output;
    return {
      id: "paint",
      label: "Frame painted",
      status: "passed",
      value: `${output.width.toLocaleString()} × ${output.height.toLocaleString()}`,
      detail: `${output.pixelsPerTile.toFixed(output.capped ? 1 : 0)} px/tile · ${output.assetTier} assets · ${formatDuration(report.wallMs)}${output.capped ? " · resolution capped" : ""}`,
    };
  }
  return {
    id: "paint",
    label: "Frame painted",
    status: progress ? "running" : "not-needed",
    value: progress?.label ?? "Waiting for render",
    detail: progress ? `${progress.value}% complete` : "No completed render receipt yet.",
  };
};

export const verificationStages = (diagnostics: PlanDiagnostics | null): PipelineStage[] => {
  if (!diagnostics) return [];
  const checks = [
    ["finite-bounds", "Finite bounds", diagnostics.checks.finiteBounds],
    ["finite-commands", "Finite command geometry", diagnostics.checks.finiteCommands],
    ["sorted-commands", "Stable layer order", diagnostics.checks.sortedCommands],
    ["frame-references", "Valid frame references", diagnostics.checks.validFrameReferences],
  ] as const;
  return checks.map(([id, label, passed]) => ({
    id,
    label,
    status: passed ? "passed" : "failed",
    value: passed ? "Passed" : "Failed",
    detail: passed
      ? "Verified against the emitted draw list."
      : "The draw list violated this invariant.",
  }));
};
