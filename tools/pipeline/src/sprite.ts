import { createHash } from "node:crypto";
import sharp from "sharp";
import { resolveSpritePath } from "./paths.js";
import type { FrameMeta, RawSprite, SpriteVariant } from "./types.js";

export interface CroppedFrame {
  /** Untrimmed source width/height. */
  sw: number;
  sh: number;
  /** Trim offset within untrimmed sprite. */
  ox: number;
  oy: number;
  /** Trimmed pixel buffer (RGBA). */
  rgba: Buffer;
  tw: number;
  th: number;
  hash: string;
}

export interface RegisteredFrame {
  id: number;
  meta: FrameMeta;
  /** Only set before packing; cleared after. */
  rgba?: Buffer;
}

/** Derive a deterministic lower-density tier while retaining canonical frame geometry. */
export async function scaleRegisteredFrames(
  frames: RegisteredFrame[],
  scale: number,
): Promise<RegisteredFrame[]> {
  if (!(scale > 0 && scale <= 1)) throw new Error(`Invalid frame scale: ${scale}`);
  return Promise.all(
    frames.map(async (frame) => {
      const rgba = frame.rgba;
      if (!rgba) throw new Error(`Frame ${frame.id} is missing pixels before scaling`);
      const width = frame.meta.pw ?? frame.meta.w;
      const height = frame.meta.ph ?? frame.meta.h;
      const packedWidth = Math.max(1, Math.round(width * scale));
      const packedHeight = Math.max(1, Math.round(height * scale));
      const data =
        packedWidth === width && packedHeight === height
          ? Buffer.from(rgba)
          : await sharp(rgba, { raw: { width, height, channels: 4 } })
              .resize(packedWidth, packedHeight, { fit: "fill", kernel: "lanczos3" })
              .raw()
              .toBuffer();
      return {
        id: frame.id,
        meta: { ...frame.meta, pw: packedWidth, ph: packedHeight },
        rgba: data,
      };
    }),
  );
}

const imageCache = new Map<string, Promise<{ data: Buffer; width: number; height: number }>>();

async function loadImage(
  absPath: string,
): Promise<{ data: Buffer; width: number; height: number }> {
  let p = imageCache.get(absPath);
  if (!p) {
    p = (async () => {
      const { data, info } = await sharp(absPath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    })();
    imageCache.set(absPath, p);
  }
  return p;
}

export function clearImageCache(): void {
  imageCache.clear();
}

export function spriteSize(s: RawSprite): [number, number] {
  if (typeof s.size === "number") return [s.size, s.size];
  if (Array.isArray(s.size)) {
    const sw = s.size[0];
    const sh = s.size[1];
    if (sw == null || sh == null)
      throw new Error(`Sprite size array incomplete: ${s.filename ?? "?"}`);
    return [sw, sh];
  }
  if (s.width != null && s.height != null) return [s.width, s.height];
  throw new Error(`Sprite missing size: ${s.filename ?? "?"}`);
}

/**
 * Source rect for animation frame `frame` and strip `dir` (0-based).
 * `dir` indexes `direction_count` rows, or `variation_count` strips when that is set:
 * - AnimationVariations (frame_count > 1): variations on Y, frames on X
 * - SpriteVariations (frame_count ≤ 1): variations in a line_length grid (often along X)
 */
/**
 * Effective animation/direction frame count for a sprite sheet.
 * SpriteNWaySheet (storage-tank, rail-endings, …) uses `frames` instead of
 * `frame_count` for how many direction cells are packed along X.
 */
export function spriteFrameCount(s: RawSprite): number {
  if (s.frame_count != null) return s.frame_count;
  if (typeof s.frames === "number" && s.frames > 0) return s.frames;
  return 1;
}

export function frameRect(
  s: RawSprite,
  frame = 0,
  dir = 0,
  imageSize?: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const [w, h] = spriteSize(s);
  const frameCount = spriteFrameCount(s);
  const directionCount = s.direction_count ?? 1;
  const variationCount = s.variation_count ?? 1;
  const lineLength = s.line_length ?? frameCount;
  const baseX = s.x ?? s.position?.[0] ?? 0;
  const baseY = s.y ?? s.position?.[1] ?? 0;

  // SpriteVariations: no animation frames — pack variations in a line_length grid.
  // `dir` is the variation index; `frame` is ignored.
  if (variationCount > 1 && frameCount <= 1) {
    const cols = s.line_length ?? variationCount;
    const col = dir % cols;
    const row = Math.floor(dir / cols);
    return { x: baseX + col * w, y: baseY + row * h, w, h };
  }

  // RotatedSprite / SpriteNWay with one animation frame packs directions in
  // a line_length grid. For example a 64-way car turret uses an 8x8 sheet.
  if (variationCount <= 1 && directionCount > 1 && frameCount === 1 && s.line_length != null) {
    return {
      x: baseX + (dir % s.line_length) * w,
      y: baseY + Math.floor(dir / s.line_length) * h,
      w,
      h,
    };
  }

  const col = frame % lineLength;
  const rowInDir = Math.floor(frame / lineLength);
  const rowsPerDir = Math.ceil(frameCount / lineLength);

  // Default Factorio layout: frames along X (wrapping by line_length), directions along Y.
  // Some 2.x sheets (electric poles, etc.) pack directions along X when the image
  // is wide enough for direction_count columns and not tall enough for rows.
  // AnimationVariations (belt connectors): `dir` is the variation index on Y.
  let dirsAlongX = false;
  if (
    variationCount <= 1 &&
    imageSize &&
    directionCount > 1 &&
    frameCount === 1 &&
    s.line_length == null
  ) {
    const fitsX = imageSize.width >= baseX + directionCount * w;
    const fitsY = imageSize.height >= baseY + directionCount * h;
    if (fitsX && !fitsY) dirsAlongX = true;
  }

  if (dirsAlongX) {
    return { x: baseX + dir * w, y: baseY + rowInDir * h, w, h };
  }

  const x = baseX + col * w;
  const y = baseY + (dir * rowsPerDir + rowInDir) * h;
  return { x, y, w, h };
}

function extractRaw(
  img: { data: Buffer; width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
): Buffer {
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcY = y + row;
    if (srcY < 0 || srcY >= img.height) continue;
    for (let col = 0; col < w; col++) {
      const srcX = x + col;
      if (srcX < 0 || srcX >= img.width) continue;
      const si = (srcY * img.width + srcX) * 4;
      const di = (row * w + col) * 4;
      out[di] = img.data[si] ?? 0;
      out[di + 1] = img.data[si + 1] ?? 0;
      out[di + 2] = img.data[si + 2] ?? 0;
      out[di + 3] = img.data[si + 3] ?? 0;
    }
  }
  return out;
}

/** Trim transparent borders (alpha threshold). */
export async function trimRgba(
  rgba: Buffer,
  w: number,
  h: number,
  threshold = 8,
): Promise<{ rgba: Buffer; tw: number; th: number; ox: number; oy: number }> {
  if (w === 0 || h === 0) {
    return { rgba, tw: w, th: h, ox: 0, oy: 0 };
  }
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3] ?? 0;
      if (a > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { rgba: Buffer.alloc(0), tw: 0, th: 0, ox: 0, oy: 0 };
  }
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  // Factorio 2.1.11 uses 1×1 __core__/graphics/empty.png leaves for unused
  // circuit-connector parts. libvips rejects trim inputs smaller than 3×3;
  // the manual bounds above are already authoritative for these tiny leaves.
  if (w < 3 || h < 3) {
    return {
      rgba: extractRaw({ data: rgba, width: w, height: h }, minX, minY, tw, th),
      tw,
      th,
      ox: minX,
      oy: minY,
    };
  }
  const { data, info } = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // sharp trim doesn't return offset in all versions via info; use recomputed bounds.
  // Prefer recomputed trim for ox/oy; use sharp output pixels when sizes match.
  if (info.width === tw && info.height === th) {
    return { rgba: data, tw, th, ox: minX, oy: minY };
  }
  const trimmed = extractRaw({ data: rgba, width: w, height: h }, minX, minY, tw, th);
  return { rgba: trimmed, tw, th, ox: minX, oy: minY };
}

/**
 * Resolve multi-file rotated sprites (`filenames` + `lines_per_file`) to a
 * single-file sprite + local frame index. Directions pack as consecutive
 * "frames" within each file (line_length columns × lines_per_file rows).
 */
export function resolveSpriteFile(
  s: RawSprite,
  frame = 0,
  dir = 0,
): { sprite: RawSprite; frame: number; dir: number } {
  if (s.filename) return { sprite: s, frame, dir };
  if (s.stripes?.length) {
    const frameCount = spriteFrameCount(s);
    let stripeIndex = 0;
    let directionBase = 0;
    while (stripeIndex < s.stripes.length) {
      const first = s.stripes[stripeIndex];
      if (!first) break;
      const height = first.height_in_frames;
      const group: typeof s.stripes = [];
      let groupWidth = 0;
      while (stripeIndex < s.stripes.length && groupWidth < frameCount) {
        const stripe = s.stripes[stripeIndex];
        if (!stripe || stripe.height_in_frames !== height) break;
        group.push(stripe);
        groupWidth += stripe.width_in_frames;
        stripeIndex++;
      }
      if (dir < directionBase + height) {
        let localFrame = ((frame % frameCount) + frameCount) % frameCount;
        let selected = group[0];
        for (const stripe of group) {
          if (localFrame < stripe.width_in_frames) {
            selected = stripe;
            break;
          }
          localFrame -= stripe.width_in_frames;
        }
        if (!selected) throw new Error(`RotatedAnimation stripe group is empty at direction ${dir}`);
        return {
          sprite: {
            ...s,
            filename: selected.filename,
            stripes: undefined,
            direction_count: height,
            frame_count: selected.width_in_frames,
            line_length: selected.width_in_frames,
          },
          frame: localFrame,
          dir: dir - directionBase,
        };
      }
      directionBase += height;
    }
    throw new Error(`RotatedAnimation stripes do not cover direction ${dir}`);
  }
  if (!s.filenames?.length) throw new Error("Sprite missing filename/filenames");

  const lineLength = s.line_length ?? spriteFrameCount(s);
  const linesPerFile =
    (s.lines_per_file as number | undefined) ??
    Math.ceil((s.direction_count ?? 1) / s.filenames.length);
  const dirsPerFile = lineLength * linesPerFile;
  const fileIndex = Math.min(s.filenames.length - 1, Math.floor(dir / dirsPerFile));
  const localDir = dir % dirsPerFile;
  const filename = s.filenames[fileIndex];
  if (!filename) throw new Error(`Sprite filenames missing index ${fileIndex}`);

  // Treat the in-file direction as a frame index on a single-direction sheet.
  return {
    sprite: {
      ...s,
      filename,
      filenames: undefined,
      direction_count: 1,
      frame_count: dirsPerFile,
      line_length: lineLength,
    },
    frame: localDir,
    dir: 0,
  };
}

export async function cropSpriteFrame(s: RawSprite, frame = 0, dir = 0): Promise<CroppedFrame> {
  const resolved = resolveSpriteFile(s, frame, dir);
  const abs = resolveSpritePath(resolved.sprite.filename as string);
  const img = await loadImage(abs);
  const rect = frameRect(resolved.sprite, resolved.frame, resolved.dir, {
    width: img.width,
    height: img.height,
  });
  const raw = extractRaw(img, rect.x, rect.y, rect.w, rect.h);
  const trimmed = await trimRgba(raw, rect.w, rect.h);
  const hash = createHash("sha256").update(trimmed.rgba).digest("hex");
  return {
    sw: rect.w,
    sh: rect.h,
    ox: trimmed.ox,
    oy: trimmed.oy,
    rgba: trimmed.rgba,
    tw: trimmed.tw,
    th: trimmed.th,
    hash,
  };
}

/** Load an entire image file as a CroppedFrame (icons, fpsr-owned markers). */
export async function cropEntireFile(absPath: string): Promise<CroppedFrame> {
  const meta = await sharp(absPath).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= 0 || h <= 0) throw new Error(`Invalid image dimensions: ${absPath}`);
  return cropFileRect(absPath, 0, 0, w, h);
}

/** Crop an arbitrary rect from a path (icons, tiles). */
export async function cropFileRect(
  absPath: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<CroppedFrame> {
  const img = await loadImage(absPath);
  const raw = extractRaw(img, x, y, w, h);
  const trimmed = await trimRgba(raw, w, h);
  const hash = createHash("sha256").update(trimmed.rgba).digest("hex");
  return {
    sw: w,
    sh: h,
    ox: trimmed.ox,
    oy: trimmed.oy,
    rgba: trimmed.rgba,
    tw: trimmed.tw,
    th: trimmed.th,
    hash,
  };
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function normalizeShift(shift: [number, number] | undefined): [number, number] {
  if (!shift) return [0, 0];
  return [round4(shift[0]), round4(shift[1])];
}

export function normalizeTint(
  tint: RawSprite["tint"],
): [number, number, number, number] | undefined {
  if (!tint) return undefined;
  if (Array.isArray(tint)) {
    const r = tint[0] ?? 1;
    const g = tint[1] ?? 1;
    const b = tint[2] ?? 1;
    const a = tint[3] ?? 1;
    // Factorio sometimes uses 0-255
    const scale = r > 1 || g > 1 || b > 1 ? 1 / 255 : 1;
    return [
      round4(r * scale),
      round4(g * scale),
      round4(b * scale),
      round4(a * (a > 1 ? 1 / 255 : 1)),
    ];
  }
  const r = tint.r ?? 1;
  const g = tint.g ?? 1;
  const b = tint.b ?? 1;
  const a = tint.a ?? 1;
  const scale = r > 1 || g > 1 || b > 1 ? 1 / 255 : 1;
  return [
    round4(r * scale),
    round4(g * scale),
    round4(b * scale),
    round4(a * (a > 1 ? 1 / 255 : 1)),
  ];
}

export class FrameBank {
  private frames: RegisteredFrame[] = [];
  private byHash = new Map<string, number>();

  async add(crop: CroppedFrame): Promise<number> {
    const existing = this.byHash.get(crop.hash);
    if (existing != null) return existing;
    // Empty (fully transparent) frames still get a 1x1 placeholder.
    let rgba = crop.rgba;
    let tw = crop.tw;
    let th = crop.th;
    let ox = crop.ox;
    let oy = crop.oy;
    if (tw === 0 || th === 0) {
      rgba = Buffer.from([0, 0, 0, 0]);
      tw = 1;
      th = 1;
      ox = 0;
      oy = 0;
    }
    const id = this.frames.length;
    this.frames.push({
      id,
      meta: {
        a: 0,
        x: 0,
        y: 0,
        w: tw,
        h: th,
        ox,
        oy,
        sw: crop.sw,
        sh: crop.sh,
      },
      rgba,
    });
    this.byHash.set(crop.hash, id);
    return id;
  }

  async addSprite(
    s: RawSprite,
    frame = 0,
    dir = 0,
  ): Promise<{
    frameId: number;
    scale: number;
    shift: [number, number];
    shadow: boolean;
    tint?: [number, number, number, number];
  }> {
    const crop = await cropSpriteFrame(s, frame, dir);
    const frameId = await this.add(crop);
    return {
      frameId,
      scale: s.scale ?? 1,
      shift: normalizeShift(s.shift),
      shadow: !!s.draw_as_shadow,
      tint: normalizeTint(s.tint),
    };
  }

  toVariant(
    info: {
      frameId: number;
      scale: number;
      shift: [number, number];
      shadow: boolean;
      tint?: [number, number, number, number];
    },
    shiftOverride?: [number, number],
    extras?: { rotation?: number; scaleY?: number; flipX?: boolean; flipY?: boolean },
  ): SpriteVariant {
    const v: SpriteVariant = {
      frame: info.frameId,
      scale: info.scale,
      shift: shiftOverride ?? info.shift,
    };
    if (info.tint) v.tint = info.tint;
    if (info.shadow) v.drawAsShadow = true;
    if (extras?.rotation != null && extras.rotation !== 0) v.rotation = extras.rotation;
    if (extras?.scaleY != null && extras.scaleY !== 1) v.scaleY = extras.scaleY;
    if (extras?.flipX) v.flipX = true;
    if (extras?.flipY) v.flipY = true;
    return v;
  }

  list(): RegisteredFrame[] {
    return this.frames;
  }

  metas(): FrameMeta[] {
    return this.frames.map((f) => f.meta);
  }
}

/** Average opaque pixel color as RGBA 0-1. */
export async function averageColor(absPath: string): Promise<[number, number, number, number]> {
  const img = await loadImage(absPath);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] ?? 0;
    if (a < 16) continue;
    r += img.data[i] ?? 0;
    g += img.data[i + 1] ?? 0;
    b += img.data[i + 2] ?? 0;
    n++;
  }
  if (n === 0) return [0.5, 0.5, 0.5, 1];
  return [round4(r / n / 255), round4(g / n / 255), round4(b / n / 255), 1];
}

/** Flatten layered / sheet / 4-way sprite trees into leaf sprites (no recursion into north/east for callers that handle dirs). */
export function leafLayers(s: RawSprite | undefined | null): RawSprite[] {
  if (!s) return [];
  if (s.layers) return s.layers.flatMap(leafLayers);
  if (s.sheets) return s.sheets.flatMap(leafLayers);
  if (s.sheet) return leafLayers(s.sheet);
  if (s.stripes?.length) return [s];
  if (s.filename || s.filenames) return [s];
  return [];
}

export function isSprite4Way(s: RawSprite): boolean {
  return !!(s.north || s.east || s.south || s.west);
}

export function dirs4(s: RawSprite): [RawSprite, RawSprite, RawSprite, RawSprite] {
  const n = s.north ?? s;
  const e = s.east ?? s;
  const sdir = s.south ?? s;
  const w = s.west ?? s;
  return [n, e, sdir, w];
}
