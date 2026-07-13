import { readFileSync } from "node:fs";
import path from "node:path";
import { GOLDEN_DIR } from "./paths.js";

export interface GoldenCase {
  name: string;
  bp: string;
  ppt: number;
  alt?: boolean;
}

export function loadCases(): GoldenCase[] {
  const raw = readFileSync(path.join(GOLDEN_DIR, "cases.json"), "utf8");
  return JSON.parse(raw) as GoldenCase[];
}

export function bpPath(c: GoldenCase): string {
  return path.join(GOLDEN_DIR, c.bp);
}

export function goldenPngPath(c: GoldenCase): string {
  return path.join(GOLDEN_DIR, `${c.name}.png`);
}
