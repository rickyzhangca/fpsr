import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RegisteredFrame } from "./sprite.js";
import type { AtlasMeta, EntityRenderDef, FrameMeta, TileRenderDef } from "./types.js";

export const ATLAS_MAX = 1024;
/** Small icon pages avoid decoding megabytes of unrelated catalog icons. */
export const ICON_ATLAS_MAX = 320;
export const MAX_CLONED_PIXEL_RATIO = 1.25;

export interface PackedAtlas {
  file: string;
  width: number;
  height: number;
  sha256: string;
  bytes: number;
}

export interface PackUsageInput {
  entities: Record<string, EntityRenderDef>;
  tiles: Record<string, TileRenderDef>;
  icons: Record<string, number>;
}

export interface PackAtlasOptions {
  format?: "png" | "webp";
}

export interface PackStats {
  sourceFrames: number;
  packedFrames: number;
  sourcePixels: number;
  packedPixels: number;
  clonedPixelRatio: number;
  groups: Record<string, { frames: number; pixels: number }>;
}

interface MutableFrameRef {
  oldId: number;
  group: string;
  assign(id: number): void;
}

interface VirtualFrame {
  id: number;
  oldId: number;
  group: string;
  domain: string;
  frame: RegisteredFrame;
}

interface Placement {
  virtualId: number;
  atlas: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rgba: Buffer;
}

interface Page {
  width: number;
  height: number;
  placements: Placement[];
}

function packedWidth(frame: RegisteredFrame): number {
  return frame.meta.pw ?? frame.meta.w;
}

function packedHeight(frame: RegisteredFrame): number {
  return frame.meta.ph ?? frame.meta.h;
}

function collectObjectFrameRefs(
  value: unknown,
  group: string,
  refs: MutableFrameRef[],
  seen = new Set<object>(),
): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const child of value) collectObjectFrameRefs(child, group, refs, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.frame === "number" && Number.isInteger(record.frame)) {
    const oldId = record.frame;
    refs.push({
      oldId,
      group,
      assign(id) {
        record.frame = id;
      },
    });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "frame") collectObjectFrameRefs(child, group, refs, seen);
  }
}

/**
 * Build mutable references and semantic co-access groups from the final
 * distilled definitions. This is deliberately independent of blueprint
 * corpora: the game-derived render DB is the only source of layout policy.
 */
function collectUsageRefs(input: PackUsageInput): MutableFrameRef[] {
  const refs: MutableFrameRef[] = [];

  for (const key of Object.keys(input.icons).sort()) {
    const oldId = input.icons[key]!;
    refs.push({
      oldId,
      group: "icons",
      assign(id) {
        input.icons[key] = id;
      },
    });
  }

  for (const name of Object.keys(input.tiles).sort()) {
    const frames = input.tiles[name]?.frames;
    if (!frames) continue;
    for (let index = 0; index < frames.length; index++) {
      const oldId = frames[index]!;
      refs.push({
        oldId,
        group: "tiles",
        assign(id) {
          frames[index] = id;
        },
      });
    }
  }

  const entityRefs = new Map<string, MutableFrameRef[]>();
  const owners = new Map<number, Set<string>>();
  for (const name of Object.keys(input.entities).sort()) {
    const entity = input.entities[name]!;
    const found: MutableFrameRef[] = [];
    collectObjectFrameRefs(entity.graphics, name, found);
    collectObjectFrameRefs(entity.data, name, found);
    entityRefs.set(name, found);
    for (const ref of found) {
      let frameOwners = owners.get(ref.oldId);
      if (!frameOwners) {
        frameOwners = new Set();
        owners.set(ref.oldId, frameOwners);
      }
      frameOwners.add(name);
    }

    if (entity.icon != null) {
      const oldId = entity.icon;
      refs.push({
        oldId,
        group: "icons",
        assign(id) {
          entity.icon = id;
        },
      });
    }
  }

  for (const name of [...entityRefs.keys()].sort()) {
    for (const ref of entityRefs.get(name) ?? []) {
      const ownerCount = owners.get(ref.oldId)?.size ?? 1;
      ref.group = ownerCount <= 4 ? `entities:${name}` : "shared-world";
      refs.push(ref);
    }
  }

  return refs;
}

function groupDomain(group: string): string {
  if (group === "icons") return "0-icons";
  if (group === "tiles") return "1-tiles";
  if (group.startsWith("entities:")) return "2-entities";
  if (group === "shared-world") return "3-shared-world";
  return "4-unreferenced";
}

function virtualFrames(
  frames: RegisteredFrame[],
  refs: MutableFrameRef[],
): { virtual: VirtualFrame[]; remap: Map<string, number>; stats: PackStats } {
  const groupFrames = new Map<string, Set<number>>();
  for (const ref of refs) {
    if (!frames[ref.oldId]) throw new Error(`Referenced frame ${ref.oldId} does not exist`);
    let ids = groupFrames.get(ref.group);
    if (!ids) {
      ids = new Set();
      groupFrames.set(ref.group, ids);
    }
    ids.add(ref.oldId);
  }

  const referenced = new Set(refs.map((ref) => ref.oldId));
  const unreferenced = frames.map((_, id) => id).filter((id) => !referenced.has(id));
  if (unreferenced.length > 0) groupFrames.set("unreferenced", new Set(unreferenced));

  const orderedGroups = [...groupFrames.keys()].sort((a, b) => {
    return groupDomain(a).localeCompare(groupDomain(b)) || a.localeCompare(b);
  });
  const virtual: VirtualFrame[] = [];
  const remap = new Map<string, number>();
  const groups: PackStats["groups"] = {};

  for (const group of orderedGroups) {
    const ids = [...(groupFrames.get(group) ?? [])].sort((a, b) => {
      const af = frames[a]!;
      const bf = frames[b]!;
      return (
        Math.max(packedWidth(bf), packedHeight(bf)) - Math.max(packedWidth(af), packedHeight(af)) ||
        packedWidth(bf) * packedHeight(bf) - packedWidth(af) * packedHeight(af) ||
        a - b
      );
    });
    let pixels = 0;
    for (const oldId of ids) {
      const frame = frames[oldId]!;
      const id = virtual.length;
      virtual.push({ id, oldId, group, domain: groupDomain(group), frame });
      remap.set(`${group}\0${oldId}`, id);
      pixels += packedWidth(frame) * packedHeight(frame);
    }
    groups[group] = { frames: ids.length, pixels };
  }

  const sourcePixels = frames.reduce(
    (sum, frame) => sum + packedWidth(frame) * packedHeight(frame),
    0,
  );
  const packedPixels = virtual.reduce(
    (sum, item) => sum + packedWidth(item.frame) * packedHeight(item.frame),
    0,
  );
  const clonedPixelRatio = sourcePixels > 0 ? packedPixels / sourcePixels : 1;
  const stats: PackStats = {
    sourceFrames: frames.length,
    packedFrames: virtual.length,
    sourcePixels,
    packedPixels,
    clonedPixelRatio,
    groups,
  };

  if (clonedPixelRatio > MAX_CLONED_PIXEL_RATIO) {
    const largest = Object.entries(groups)
      .sort((a, b) => b[1].pixels - a[1].pixels)
      .slice(0, 12)
      .map(([group, value]) => `${group}=${value.frames} frames/${value.pixels} px`)
      .join(", ");
    throw new Error(
      `Usage-aware cloning is ${(clonedPixelRatio * 100).toFixed(1)}% of source pixels; ` +
        `limit is ${(MAX_CLONED_PIXEL_RATIO * 100).toFixed(0)}%. Largest groups: ${largest}`,
    );
  }

  return { virtual, remap, stats };
}

function placeFrames(virtual: VirtualFrame[]): Page[] {
  const pages: Page[] = [];
  let placements: Placement[] = [];
  let shelves: { y: number; height: number; x: number }[] = [];
  let width = 0;
  let height = 0;
  let domain: string | undefined;

  const finishPage = (): void => {
    if (placements.length === 0) return;
    pages.push({ width: Math.max(1, width), height: Math.max(1, height), placements });
    placements = [];
    shelves = [];
    width = 0;
    height = 0;
  };

  const placeRegular = (item: VirtualFrame, maxSize: number): boolean => {
    const w = packedWidth(item.frame);
    const h = packedHeight(item.frame);
    const rgba = item.frame.rgba;
    if (!rgba) throw new Error(`Frame ${item.oldId} is missing pixels before pack`);
    for (const shelf of shelves) {
      if (h > shelf.height || shelf.x + w > maxSize) continue;
      const x = shelf.x;
      shelf.x += w;
      width = Math.max(width, shelf.x);
      height = Math.max(height, shelf.y + shelf.height);
      placements.push({
        virtualId: item.id,
        atlas: pages.length,
        x,
        y: shelf.y,
        w,
        h,
        rgba,
      });
      return true;
    }
    const y = height;
    if (w > maxSize || y + h > maxSize) return false;
    shelves.push({ y, height: h, x: w });
    width = Math.max(width, w);
    height = y + h;
    placements.push({
      virtualId: item.id,
      atlas: pages.length,
      x: 0,
      y,
      w,
      h,
      rgba,
    });
    return true;
  };

  for (const item of virtual) {
    if (domain !== undefined && item.domain !== domain) finishPage();
    domain = item.domain;
    const w = packedWidth(item.frame);
    const h = packedHeight(item.frame);
    const maxSize = item.domain === "0-icons" ? ICON_ATLAS_MAX : ATLAS_MAX;
    if (w > maxSize || h > maxSize) {
      finishPage();
      const rgba = item.frame.rgba;
      if (!rgba) throw new Error(`Frame ${item.oldId} is missing pixels before pack`);
      pages.push({
        width: Math.max(1, w),
        height: Math.max(1, h),
        placements: [{ virtualId: item.id, atlas: pages.length, x: 0, y: 0, w, h, rgba }],
      });
      continue;
    }
    if (!placeRegular(item, maxSize)) {
      finishPage();
      if (!placeRegular(item, maxSize)) throw new Error(`Cannot place frame ${w}x${h}`);
    }
  }
  finishPage();
  return pages;
}

export async function packAtlases(
  frames: RegisteredFrame[],
  usage: PackUsageInput,
  outDir: string,
  options: PackAtlasOptions = {},
): Promise<{
  atlases: AtlasMeta[];
  manifestAtlases: PackedAtlas[];
  frames: FrameMeta[];
  stats: PackStats;
}> {
  await mkdir(outDir, { recursive: true });
  const refs = collectUsageRefs(usage);
  const { virtual, remap, stats } = virtualFrames(frames, refs);
  const pages = placeFrames(virtual);
  const atlases: AtlasMeta[] = [];
  const manifestAtlases: PackedAtlas[] = [];
  const frameMetas: FrameMeta[] = virtual.map((item) => ({ ...item.frame.meta }));
  const atlasByHash = new Map<string, number>();

  for (let atlasIndex = 0; atlasIndex < pages.length; atlasIndex++) {
    const page = pages[atlasIndex]!;
    const composites: sharp.OverlayOptions[] = [];
    for (const placement of page.placements) {
      if (placement.w > 0 && placement.h > 0) {
        composites.push({
          input: await sharp(placement.rgba, {
            raw: { width: placement.w, height: placement.h, channels: 4 },
          })
            .png()
            .toBuffer(),
          left: placement.x,
          top: placement.y,
        });
      }
    }

    const image = sharp({
      create: {
        width: page.width,
        height: page.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(composites);
    const format = options.format ?? "png";
    const encoded =
      format === "webp"
        ? await image.webp({ lossless: true, effort: 6 }).toBuffer()
        : await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    const sha256 = createHash("sha256").update(encoded).digest("hex");
    const file = `atlas.${sha256}.${format}`;
    const existingAtlas = atlasByHash.get(sha256);
    const finalAtlasIndex = existingAtlas ?? atlases.length;
    for (const placement of page.placements) {
      const meta = frameMetas[placement.virtualId]!;
      meta.a = finalAtlasIndex;
      meta.x = placement.x;
      meta.y = placement.y;
      if (meta.pw != null) meta.pw = placement.w;
      if (meta.ph != null) meta.ph = placement.h;
    }
    if (existingAtlas != null) {
      console.log(
        `pack: ${file.slice(0, 22)}… reused atlas ${existingAtlas} (${page.placements.length} frames)`,
      );
      continue;
    }
    await writeFile(path.join(outDir, file), encoded);
    atlasByHash.set(sha256, finalAtlasIndex);
    atlases.push({ file, width: page.width, height: page.height });
    manifestAtlases.push({
      file,
      width: page.width,
      height: page.height,
      sha256,
      bytes: encoded.byteLength,
    });
    console.log(
      `pack: ${file.slice(0, 22)}… ${page.width}x${page.height} ` +
        `(${(encoded.byteLength / 1024).toFixed(0)} KB, ${page.placements.length} frames)`,
    );
  }

  for (const ref of refs) {
    const id = remap.get(`${ref.group}\0${ref.oldId}`);
    if (id == null) throw new Error(`No packed frame for ${ref.group}:${ref.oldId}`);
    ref.assign(id);
  }
  for (const frame of frames) frame.rgba = undefined;

  return { atlases, manifestAtlases, frames: frameMetas, stats };
}
