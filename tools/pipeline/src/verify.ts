import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RenderDb } from "./types.js";

export interface AssetManifestV2 {
  schema: 2;
  gameVersion: string;
  mods: string[];
  tiers: Record<AssetTier, AssetTierDescriptor>;
}

export type AssetTier = "1x" | "2x";

export interface AssetTierDescriptor {
  density: 1 | 2;
  renderDb: { file: string; sha256: string; bytes?: number };
  atlases: { file: string; w: number; h: number; sha256: string; bytes?: number }[];
}

export interface VerifyResult {
  gameVersion: string;
  atlases: number;
  frames: number;
  referencedFrames: number;
  bytes: number;
  decodedPixels: number;
  tiers: Record<
    AssetTier,
    { atlases: number; frames: number; bytes: number; decodedPixels: number }
  >;
}

// With both tiers using the same lossless codec, the 1x tier is about 30% of
// the 2x pixel area. Leave compression variance across mod profiles without
// permitting a materially oversized derived tier.
const MAX_TIERED_STORAGE_RATIO = 1.4;

export function assertTierStorageCeiling(tiers: Record<AssetTier, { bytes: number }>): void {
  const baselineBytes = tiers["2x"].bytes;
  const generatedBytes = baselineBytes + tiers["1x"].bytes;
  if (baselineBytes <= 0 || generatedBytes <= baselineBytes * MAX_TIERED_STORAGE_RATIO) return;
  throw new Error(
    `Tiered asset content ${(generatedBytes / 1024 / 1024).toFixed(2)} MiB exceeds ` +
      `${(MAX_TIERED_STORAGE_RATIO * 100).toFixed(0)}% of the 2x-only ` +
      `${(baselineBytes / 1024 / 1024).toFixed(2)} MiB baseline ` +
      `(1x ${(tiers["1x"].bytes / 1024 / 1024).toFixed(2)} MiB)`,
  );
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function collectObjectFrames(value: unknown, ids: Set<number>, seen = new Set<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) collectObjectFrames(child, ids, seen);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.frame === "number" && Number.isInteger(record.frame)) ids.add(record.frame);
  for (const [key, child] of Object.entries(record)) {
    if (key !== "frame") collectObjectFrames(child, ids, seen);
  }
}

export function collectReferencedFrames(db: RenderDb): Set<number> {
  const ids = new Set<number>(Object.values(db.icons));
  for (const tile of Object.values(db.tiles)) {
    for (const frame of tile.frames ?? []) ids.add(frame);
  }
  for (const entity of Object.values(db.entities)) {
    if (entity.icon != null) ids.add(entity.icon);
    collectObjectFrames(entity.graphics, ids);
    collectObjectFrames(entity.data, ids);
  }
  return ids;
}

export async function readAssetBundle(
  dir: string,
  tier: AssetTier = "2x",
): Promise<{ manifest: AssetManifestV2; descriptor: AssetTierDescriptor; db: RenderDb }> {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as
    | AssetManifestV2
    | { schema?: unknown };
  if (manifest.schema !== 2) {
    throw new Error(`Unsupported manifest schema ${String(manifest.schema)} in ${dir}`);
  }
  const typedManifest = manifest as AssetManifestV2;
  const descriptor = typedManifest.tiers?.[tier];
  if (!descriptor) throw new Error(`Manifest is missing ${tier} tier in ${dir}`);
  const db = JSON.parse(
    await readFile(path.join(dir, descriptor.renderDb.file), "utf8"),
  ) as RenderDb;
  return { manifest: typedManifest, descriptor, db };
}

export async function verifyAssetBundle(dir: string): Promise<VerifyResult> {
  const manifest = JSON.parse(
    await readFile(path.join(dir, "manifest.json"), "utf8"),
  ) as AssetManifestV2;
  if (manifest.schema !== 2 || !manifest.tiers?.["1x"] || !manifest.tiers?.["2x"]) {
    throw new Error(`Invalid schema-2 tiered manifest in ${dir}`);
  }
  let bytes = 0;
  let decodedPixels = 0;
  let atlases = 0;
  let frames = 0;
  let referencedFrames = 0;
  const tiers = {} as VerifyResult["tiers"];

  for (const tier of ["1x", "2x"] as const) {
    const { descriptor, db } = await readAssetBundle(dir, tier);
    const expectedDensity = tier === "1x" ? 1 : 2;
    if (descriptor.density !== expectedDensity) {
      throw new Error(`${tier} manifest density must be ${expectedDensity}`);
    }
    if (db.schema !== 2) throw new Error(`Unsupported render-db schema ${String(db.schema)}`);
    if (db.assetDensity !== descriptor.density) {
      throw new Error(
        `${tier} density mismatch: manifest=${descriptor.density}, db=${db.assetDensity}`,
      );
    }
    if (db.gameVersion !== manifest.gameVersion) {
      throw new Error(`Version mismatch: manifest=${manifest.gameVersion}, db=${db.gameVersion}`);
    }
    if (JSON.stringify(db.mods) !== JSON.stringify(manifest.mods)) {
      throw new Error("Official mod list differs between manifest and render-db");
    }
    if (db.atlases.length !== descriptor.atlases.length) {
      throw new Error(
        `${tier} atlas count mismatch: db=${db.atlases.length}, manifest=${descriptor.atlases.length}`,
      );
    }

    let tierBytes = 0;
    let tierDecodedPixels = 0;
    const dbData = await readFile(path.join(dir, descriptor.renderDb.file));
    tierBytes += dbData.byteLength;
    if (sha256(dbData) !== descriptor.renderDb.sha256)
      throw new Error(`${tier} render-db hash mismatch`);
    if (descriptor.renderDb.bytes != null && descriptor.renderDb.bytes !== dbData.byteLength) {
      throw new Error("Render-db byte count mismatch");
    }
    if (!descriptor.renderDb.file.includes(descriptor.renderDb.sha256)) {
      throw new Error("Render-db filename is not content-addressed by its hash");
    }

    for (let index = 0; index < descriptor.atlases.length; index++) {
      const atlas = descriptor.atlases[index]!;
      const dbAtlas = db.atlases[index]!;
      if (dbAtlas.file !== atlas.file || dbAtlas.width !== atlas.w || dbAtlas.height !== atlas.h) {
        throw new Error(`Atlas ${index} metadata differs between manifest and render-db`);
      }
      const filename = path.join(dir, atlas.file);
      const data = await readFile(filename);
      const info = await sharp(data).metadata();
      tierBytes += data.byteLength;
      tierDecodedPixels += atlas.w * atlas.h;
      if (sha256(data) !== atlas.sha256) throw new Error(`Atlas ${index} hash mismatch`);
      if (!atlas.file.includes(atlas.sha256)) {
        throw new Error(`Atlas ${index} filename is not content-addressed by its hash`);
      }
      if (info.width !== atlas.w || info.height !== atlas.h) {
        throw new Error(
          `Atlas ${index} dimensions mismatch: manifest=${atlas.w}x${atlas.h}, image=${info.width}x${info.height}`,
        );
      }
      if (atlas.bytes != null && atlas.bytes !== data.byteLength) {
        throw new Error(`Atlas ${index} byte count mismatch`);
      }
    }

    for (let id = 0; id < db.frames.length; id++) {
      const frame = db.frames[id]!;
      const atlas = db.atlases[frame.a];
      if (!atlas) throw new Error(`Frame ${id} refers to missing atlas ${frame.a}`);
      if (
        frame.x < 0 ||
        frame.y < 0 ||
        (frame.pw ?? frame.w) <= 0 ||
        (frame.ph ?? frame.h) <= 0 ||
        frame.x + (frame.pw ?? frame.w) > atlas.width ||
        frame.y + (frame.ph ?? frame.h) > atlas.height
      ) {
        throw new Error(`Frame ${id} lies outside atlas ${frame.a}`);
      }
    }

    const referenced = collectReferencedFrames(db);
    for (const id of referenced) {
      if (!Number.isInteger(id) || !db.frames[id])
        throw new Error(`Missing referenced frame ${id}`);
    }
    tiers[tier] = {
      atlases: descriptor.atlases.length,
      frames: db.frames.length,
      bytes: tierBytes,
      decodedPixels: tierDecodedPixels,
    };
    bytes += tierBytes;
    decodedPixels += tierDecodedPixels;
    atlases += descriptor.atlases.length;
    frames += db.frames.length;
    referencedFrames += referenced.size;
  }
  assertTierStorageCeiling(tiers);
  bytes += (await stat(path.join(dir, "manifest.json"))).size;

  return {
    gameVersion: manifest.gameVersion,
    atlases,
    frames,
    referencedFrames,
    bytes,
    decodedPixels,
    tiers,
  };
}
