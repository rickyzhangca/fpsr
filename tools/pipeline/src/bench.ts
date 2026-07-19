import { readFile } from "node:fs/promises";
import path from "node:path";
import { decode, selectBlueprint, type RenderDb } from "@rickyzhangca/fpsr";
import { planDrawList } from "@rickyzhangca/fpsr/planner";
import { readAssetBundle, type AssetTier } from "./verify.js";

export interface AssetBenchResult {
  tier: AssetTier;
  blueprint: string;
  commands: number;
  uniqueFrames: number;
  atlasIndices: number[];
  decodedPixels: number;
  decodedBytes: number;
  blobBytes: number;
  targetDecodedPixels: number;
  passesDecodedPixelTarget: boolean;
}

export async function benchAssetUsage(
  blueprintFile: string,
  assetDir: string,
  tier: AssetTier = "2x",
): Promise<AssetBenchResult> {
  const source = await readFile(blueprintFile, "utf8");
  const doc = decode(source);
  const blueprint = selectBlueprint(doc);
  const { descriptor, db } = await readAssetBundle(assetDir, tier);
  const list = planDrawList(blueprint, db as RenderDb, { altMode: true });
  const frameIds = new Set<number>();
  for (const command of list.commands) {
    if (command.kind === "sprite" || command.kind === "icon") {
      frameIds.add(command.frame);
      if (command.kind === "icon" && command.backingFrame != null) {
        frameIds.add(command.backingFrame);
      }
    }
  }
  const atlasIndices = new Set<number>();
  for (const id of frameIds) {
    const frame = db.frames[id];
    if (!frame) throw new Error(`Draw list refers to missing frame ${id}`);
    atlasIndices.add(frame.a);
  }
  const orderedAtlases = [...atlasIndices].sort((a, b) => a - b);
  const decodedPixels = orderedAtlases.reduce((sum, index) => {
    const atlas = descriptor.atlases[index];
    if (!atlas) throw new Error(`Missing manifest atlas ${index}`);
    return sum + atlas.w * atlas.h;
  }, 0);
  const blobBytes = orderedAtlases.reduce(
    (sum, index) => sum + (descriptor.atlases[index]?.bytes ?? 0),
    0,
  );
  const targetDecodedPixels = 25_000_000;
  return {
    tier,
    blueprint: path.resolve(blueprintFile),
    commands: list.commands.length,
    uniqueFrames: frameIds.size,
    atlasIndices: orderedAtlases,
    decodedPixels,
    decodedBytes: decodedPixels * 4,
    blobBytes,
    targetDecodedPixels,
    passesDecodedPixelTarget: decodedPixels <= targetDecodedPixels,
  };
}

export function formatAssetBench(result: AssetBenchResult): string {
  const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  return [
    `Asset usage (${result.tier}): ${result.blueprint}`,
    `  commands:        ${result.commands.toLocaleString()}`,
    `  unique frames:   ${result.uniqueFrames.toLocaleString()}`,
    `  atlases:         ${result.atlasIndices.length} [${result.atlasIndices.join(", ")}]`,
    `  decoded pixels:  ${(result.decodedPixels / 1_000_000).toFixed(2)} MP`,
    `  decoded RGBA:    ${mb(result.decodedBytes)}`,
    `  blob bytes:      ${mb(result.blobBytes)}`,
    `  ≤25 MP target:   ${result.passesDecodedPixelTarget ? "PASS" : "FAIL"}`,
  ].join("\n");
}
