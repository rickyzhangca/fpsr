import type { AssetEvent, DecodeStats, RenderProfile } from "fpsr";

export interface PerfReportBlueprint {
  entityCount: number;
  tileCount: number;
  wireCount: number;
  version: string;
  topEntities: { name: string; count: number }[];
}

/**
 * Viewer-assembled report for the Performance tab: renderer profile plus
 * decode stats, display blit timing, and session asset details.
 */
export interface PerfReport {
  at: number;
  cold: boolean;
  blitMs: number;
  /** Wall-clock for render() + display blit. */
  wallMs: number;
  profile: RenderProfile;
  decode?: DecodeStats;
  blueprint: PerfReportBlueprint;
  /** Detailed CDN events captured during this render window (bytes, fetch/decode). */
  assetDetails: AssetEvent[];
  /** Cumulative non-cached response body bytes processed this session. */
  sessionBytes: number;
}
