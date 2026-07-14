import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RenderDb } from "./types.js";

export interface AssetManifestV2 {
  schema: 2;
  gameVersion: string;
  mods: string[];
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
): Promise<{ manifest: AssetManifestV2; db: RenderDb }> {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as
    | AssetManifestV2
    | { schema?: unknown };
  if (manifest.schema !== 2) {
    throw new Error(`Unsupported manifest schema ${String(manifest.schema)} in ${dir}`);
  }
  const typedManifest = manifest as AssetManifestV2;
  const db = JSON.parse(
    await readFile(path.join(dir, typedManifest.renderDb.file), "utf8"),
  ) as RenderDb;
  return { manifest: typedManifest, db };
}

export async function verifyAssetBundle(dir: string): Promise<VerifyResult> {
  const { manifest, db } = await readAssetBundle(dir);
  if (db.schema !== 2) throw new Error(`Unsupported render-db schema ${String(db.schema)}`);
  if (db.gameVersion !== manifest.gameVersion) {
    throw new Error(`Version mismatch: manifest=${manifest.gameVersion}, db=${db.gameVersion}`);
  }
  if (JSON.stringify(db.mods) !== JSON.stringify(manifest.mods)) {
    throw new Error("Official mod list differs between manifest and render-db");
  }
  if (db.atlases.length !== manifest.atlases.length) {
    throw new Error(
      `Atlas count mismatch: db=${db.atlases.length}, manifest=${manifest.atlases.length}`,
    );
  }

  let bytes = 0;
  let decodedPixels = 0;
  const dbData = await readFile(path.join(dir, manifest.renderDb.file));
  bytes += dbData.byteLength;
  if (sha256(dbData) !== manifest.renderDb.sha256) throw new Error("Render-db hash mismatch");
  if (manifest.renderDb.bytes != null && manifest.renderDb.bytes !== dbData.byteLength) {
    throw new Error("Render-db byte count mismatch");
  }
  if (!manifest.renderDb.file.includes(manifest.renderDb.sha256)) {
    throw new Error("Render-db filename is not content-addressed by its hash");
  }

  for (let index = 0; index < manifest.atlases.length; index++) {
    const atlas = manifest.atlases[index]!;
    const dbAtlas = db.atlases[index]!;
    if (dbAtlas.file !== atlas.file || dbAtlas.width !== atlas.w || dbAtlas.height !== atlas.h) {
      throw new Error(`Atlas ${index} metadata differs between manifest and render-db`);
    }
    const filename = path.join(dir, atlas.file);
    const data = await readFile(filename);
    const info = await sharp(data).metadata();
    bytes += data.byteLength;
    decodedPixels += atlas.w * atlas.h;
    if (sha256(data) !== atlas.sha256) throw new Error(`Atlas ${index} hash mismatch`);
    if (!atlas.file.includes(atlas.sha256)) {
      throw new Error(`Atlas ${index} filename is not content-addressed by its hash`);
    }
    if (info.width !== atlas.w || info.height !== atlas.h) {
      throw new Error(
        `Atlas ${index} dimensions mismatch: manifest=${atlas.w}x${atlas.h}, png=${info.width}x${info.height}`,
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
      frame.w <= 0 ||
      frame.h <= 0 ||
      frame.x + frame.w > atlas.width ||
      frame.y + frame.h > atlas.height
    ) {
      throw new Error(`Frame ${id} lies outside atlas ${frame.a}`);
    }
  }

  const referenced = collectReferencedFrames(db);
  for (const id of referenced) {
    if (!Number.isInteger(id) || !db.frames[id]) throw new Error(`Missing referenced frame ${id}`);
  }
  bytes += (await stat(path.join(dir, "manifest.json"))).size;

  return {
    gameVersion: manifest.gameVersion,
    atlases: manifest.atlases.length,
    frames: db.frames.length,
    referencedFrames: referenced.size,
    bytes,
    decodedPixels,
  };
}
