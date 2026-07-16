import { ScrollArea } from "@/components/ui/scroll-area";
import type { PerfReport } from "./perf-report";

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const abs = Math.abs(ms);
  let body: string;
  if (abs < 0.005) body = "0ms";
  else if (abs < 1) body = `${abs.toFixed(2)}ms`;
  else if (abs < 10) body = `${abs.toFixed(2)}ms`;
  else if (abs < 100) body = `${abs.toFixed(1)}ms`;
  else body = `${Math.round(abs)}ms`;
  return ms < 0 && abs >= 0.005 ? `-${body}` : body;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtRate(numer: number, denomMs: number, unit: string): string {
  if (denomMs <= 0) return `— ${unit}`;
  const perSec = (numer / denomMs) * 1000;
  if (perSec >= 1_000_000) return `${(perSec / 1_000_000).toFixed(2)}M ${unit}`;
  if (perSec >= 1000) return `${(perSec / 1000).toFixed(1)}k ${unit}`;
  return `${perSec.toFixed(0)} ${unit}`;
}

function bar(fraction: number, width = 20): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function stageLine(label: string, ms: number, totalMs: number): string {
  const pct = totalMs > 0 ? ms / totalMs : 0;
  return `  ${label.padEnd(14)} ${fmtMs(ms).padStart(8)}  ${bar(pct)}  ${(pct * 100).toFixed(1)}%`;
}

function formatLayerHistogram(hist: Record<string, number>): string {
  const entries = Object.entries(hist)
    .map(([layer, count]) => ({ layer: Number(layer), count }))
    .sort((a, b) => b.count - a.count || a.layer - b.layer);
  if (entries.length === 0) return "  (none)";
  const max = entries[0]?.count ?? 1;
  return entries
    .slice(0, 12)
    .map(({ layer, count }) => {
      const pct = max > 0 ? count / max : 0;
      return `  layer ${String(layer).padStart(3)}  ${String(count).padStart(5)}  ${bar(pct, 12)}`;
    })
    .join("\n");
}

/** Format a PerfReport as plain monospace text. */
export function formatPerfReport(report: PerfReport): string {
  const { profile, decode, blueprint, assetDetails } = report;
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════");
  lines.push(
    ` FPSR PERFORMANCE  ·  ${report.cold ? "COLD" : "WARM"}  ·  ${new Date(report.at).toLocaleTimeString()}`,
  );
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");

  const stages: { label: string; ms: number }[] = [];
  if (decode) stages.push({ label: "decode", ms: decode.timings.totalMs });
  stages.push({ label: "select", ms: profile.selectMs });
  stages.push({ label: "plan", ms: profile.plan.totalMs });
  stages.push({ label: "assets", ms: profile.assetsMs });
  stages.push({ label: "icon bake", ms: profile.iconBakeMs });
  stages.push({ label: "frame", ms: profile.frameMs });
  stages.push({ label: "paint", ms: profile.paintMs });

  lines.push("STAGE TIMINGS");
  lines.push("───────────────────────────────────────────────────────────");
  for (const s of stages) {
    lines.push(stageLine(s.label, s.ms, report.wallMs));
  }
  lines.push(`  ${"TOTAL".padEnd(14)} ${fmtMs(report.wallMs).padStart(8)}  (worker render wall)`);
  lines.push(
    `  ${"profile".padEnd(14)} ${fmtMs(profile.totalMs).padStart(8)}  (inside renderer.render)`,
  );
  lines.push("");

  lines.push("PLAN PHASES");
  lines.push("───────────────────────────────────────────────────────────");
  const plan = profile.plan;
  const planStages = [
    ["migrate", plan.migrateMs],
    ["resolve", plan.resolveMs],
    ["tiles", plan.tilesMs],
    ["entities", plan.entitiesMs],
    ["overlays", plan.overlaysMs],
    ["sort", plan.sortMs],
  ] as const;
  for (const [label, ms] of planStages) {
    lines.push(stageLine(label, ms, plan.totalMs));
  }
  lines.push(`  ${"plan total".padEnd(14)} ${fmtMs(plan.totalMs).padStart(8)}`);
  lines.push("");

  lines.push("INPUT");
  lines.push("───────────────────────────────────────────────────────────");
  if (decode) {
    lines.push(`  mode              ${decode.mode}`);
    lines.push(`  input chars       ${decode.inputChars.toLocaleString()}`);
    if (decode.compressedBytes != null) {
      lines.push(`  compressed        ${fmtBytes(decode.compressedBytes)}`);
    }
    if (decode.inflatedBytes != null) {
      lines.push(`  inflated          ${fmtBytes(decode.inflatedBytes)}`);
    }
    lines.push(`  json chars        ${decode.jsonChars.toLocaleString()}`);
    if (decode.compressionRatio != null) {
      lines.push(`  compression       ${decode.compressionRatio.toFixed(1)}×`);
    }
    if (decode.timings.base64Ms != null) {
      lines.push(`  base64            ${fmtMs(decode.timings.base64Ms)}`);
      lines.push(`  inflate           ${fmtMs(decode.timings.inflateMs ?? 0)}`);
      lines.push(`  utf8              ${fmtMs(decode.timings.utf8Ms ?? 0)}`);
    }
    lines.push(`  json.parse        ${fmtMs(decode.timings.jsonParseMs)}`);
    lines.push(`  validate          ${fmtMs(decode.timings.validateMs)}`);
  } else {
    lines.push("  (no decode stats — blueprint was already decoded)");
  }
  lines.push("");

  lines.push("BLUEPRINT");
  lines.push("───────────────────────────────────────────────────────────");
  lines.push(`  version           ${blueprint.version}`);
  lines.push(`  entities          ${blueprint.entityCount.toLocaleString()}`);
  lines.push(`  tiles             ${blueprint.tileCount.toLocaleString()}`);
  lines.push(`  wires             ${blueprint.wireCount.toLocaleString()}`);
  if (blueprint.topEntities.length > 0) {
    lines.push("  top entities:");
    for (const { name, count } of blueprint.topEntities.slice(0, 5)) {
      lines.push(`    ${String(count).padStart(5)} × ${name}`);
    }
  }
  lines.push("");

  const dl = profile.drawList;
  lines.push("DRAW LIST");
  lines.push("───────────────────────────────────────────────────────────");
  lines.push(`  commands          ${dl.commandCount.toLocaleString()}`);
  const kinds = Object.entries(dl.byKind).sort((a, b) => b[1] - a[1]);
  for (const [kind, count] of kinds) {
    lines.push(`    ${kind.padEnd(14)} ${count.toLocaleString()}`);
  }
  lines.push(`  unique frames     ${dl.uniqueFrames.toLocaleString()}`);
  lines.push(
    `  atlases used      ${dl.atlasIndices.length} / ${profile.db.atlasCount}  [${dl.atlasIndices.join(", ")}]`,
  );
  lines.push("  layers:");
  lines.push(formatLayerHistogram(dl.layerHistogram));
  lines.push("");

  lines.push("ASSETS");
  lines.push("───────────────────────────────────────────────────────────");
  lines.push(
    `  render-db         ${profile.db.entityDefs} entities · ${profile.db.tileDefs} tiles · ${profile.db.frameCount} frames · ${profile.db.atlasCount} atlases`,
  );
  for (const kind of ["manifest", "render-db"] as const) {
    const events = assetDetails.filter((event) => event.kind === kind);
    if (events.length === 0) continue;
    const detail = events.find((event) => !event.cached) ?? events[0]!;
    const label = kind === "manifest" ? "manifest" : "render-db file";
    const tag = detail.cached ? "cache" : "fetch";
    const cacheHits = events.filter((event) => event.cached).length;
    const extra = detail.cached
      ? cacheHits > 1
        ? `  ${cacheHits} hits`
        : ""
      : `  fetch ${fmtMs(detail.fetchMs ?? 0)}  ${fmtBytes(detail.bytes ?? 0)}${cacheHits > 0 ? `  ${cacheHits} cache hits` : ""}`;
    lines.push(`  ${label.padEnd(17)} [${tag}]  ${fmtMs(detail.totalMs)}${extra}`);
  }
  if (profile.assets.length === 0) {
    lines.push("  (no atlases referenced)");
  } else {
    for (const ev of profile.assets) {
      const detail = assetDetails.find(
        (d) => d.kind === "atlas" && d.index === ev.index && !d.cached,
      );
      const tag = ev.cached ? "cache" : "fetch";
      const extra =
        detail && !ev.cached
          ? `  fetch ${fmtMs(detail.fetchMs ?? 0)}  queue ${fmtMs(detail.queueMs ?? 0)}  decode ${fmtMs(detail.decodeMs ?? 0)}  ${((detail.decodedPixels ?? 0) / 1_000_000).toFixed(2)} MP  ${fmtBytes(detail.bytes ?? 0)}`
          : "";
      lines.push(`  atlas ${String(ev.index).padStart(2)}  [${tag}]  ${fmtMs(ev.totalMs)}${extra}`);
    }
  }
  const referencedAtlases = new Set(profile.drawList.atlasIndices);
  const referencedDetails = assetDetails.filter(
    (event) =>
      event.kind === "atlas" &&
      event.index != null &&
      referencedAtlases.has(event.index) &&
      !event.cached,
  );
  const detailBytes = referencedDetails.reduce((s, e) => s + (e.bytes ?? 0), 0);
  if (detailBytes > 0) {
    lines.push(`  atlas blobs        ${fmtBytes(detailBytes)} processed during render`);
  }
  const referencedPixels = profile.assets.reduce(
    (sum, event) => sum + (event.decodedPixels ?? 0),
    0,
  );
  if (referencedPixels > 0) {
    lines.push(`  referenced pixels ${(referencedPixels / 1_000_000).toFixed(2)} MP`);
  }
  const overlapping = assetDetails.filter(
    (event) =>
      event.kind === "atlas" &&
      event.index != null &&
      !referencedAtlases.has(event.index) &&
      !event.cached,
  );
  const overlappingPixels = overlapping.reduce((sum, event) => sum + (event.decodedPixels ?? 0), 0);
  if (overlapping.length > 0) {
    const overlappingBytes = overlapping.reduce((sum, event) => sum + (event.bytes ?? 0), 0);
    lines.push(
      `  overlapping loads  ${overlapping.length} atlases · ${(overlappingPixels / 1_000_000).toFixed(2)} MP · ${fmtBytes(overlappingBytes)}`,
    );
  }
  lines.push(`  session total      ${fmtBytes(report.sessionBytes)} blob bytes processed`);
  lines.push(
    `  icon bake          ${profile.iconBakeCount} icons · ${profile.silhouetteBakeCount} silhouettes · ${fmtMs(profile.iconBakeMs)}`,
  );
  lines.push(
    `  icon cache         ${profile.iconCacheHits} hits · ${profile.iconCacheMisses} misses`,
  );
  lines.push(
    `  silhouette cache   ${profile.silhouetteCacheHits} hits · ${profile.silhouetteCacheMisses} misses`,
  );
  lines.push("");

  const out = profile.output;
  const tilesW = out.tileFrame.maxX - out.tileFrame.minX;
  const tilesH = out.tileFrame.maxY - out.tileFrame.minY;
  const screens4k = out.megapixels / ((3840 * 2160) / 1_000_000);
  lines.push("OUTPUT");
  lines.push("───────────────────────────────────────────────────────────");
  lines.push(`  canvas            ${out.width} × ${out.height} px`);
  lines.push(`  megapixels        ${out.megapixels.toFixed(3)} MP`);
  lines.push(
    `  pixels/tile       ${out.pixelsPerTile.toFixed(out.capped ? 2 : 0)}${out.capped ? ` (requested ${out.requestedPixelsPerTile})` : ""}`,
  );
  lines.push(`  asset tier        ${out.assetTier}`);
  lines.push(`  resolution cap    ${out.capped ? "applied" : "none"}`);
  lines.push(`  tile frame        ${tilesW} × ${tilesH} tiles`);
  lines.push(`  vs 4K screen      ${screens4k.toFixed(2)}×`);
  lines.push(
    `  shadow scratch   ${(profile.shadow.peakScratchPixels / 1_000_000).toFixed(2)} MP peak`,
  );
  lines.push(
    `  shadow work      ${profile.shadow.runs} runs · ${profile.shadow.tiles} tiles · ${(profile.shadow.compositedPixels / 1_000_000).toFixed(2)} MP composited`,
  );
  lines.push("");

  const spriteCount = dl.byKind.sprite ?? 0;
  const entityCount = Math.max(1, blueprint.entityCount);
  lines.push("THROUGHPUT");
  lines.push("───────────────────────────────────────────────────────────");
  lines.push(
    `  resolve            ${fmtRate(blueprint.entityCount, plan.resolveMs, "entities/s")}`,
  );
  lines.push(`  plan               ${fmtRate(dl.commandCount, plan.totalMs, "commands/s")}`);
  lines.push(`  paint              ${fmtRate(spriteCount, profile.paintMs, "sprites/s")}`);
  lines.push(`  paint              ${fmtRate(out.megapixels, profile.paintMs, "MP/s")}`);
  lines.push(`  sprites/entity     ${(spriteCount / entityCount).toFixed(2)}`);
  lines.push(`  commands/entity    ${(dl.commandCount / entityCount).toFixed(2)}`);
  lines.push("");
  lines.push("Tip: open DevTools → Performance to see fpsr-* marks/measures.");

  return lines.join("\n");
}

export function PerformancePane({ report }: { report: PerfReport | null }) {
  if (!report) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-muted-foreground text-sm">
        Render a blueprint in Preview first to collect performance data.
      </div>
    );
  }

  const text = formatPerfReport(report);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <pre className="whitespace-pre p-4 font-mono text-xs leading-relaxed text-foreground">
        {text}
      </pre>
    </ScrollArea>
  );
}
