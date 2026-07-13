import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ATLAS_MAX } from "./paths.js";
import type { RegisteredFrame } from "./sprite.js";
import type { AtlasMeta, FrameMeta } from "./types.js";

interface Shelf {
  y: number;
  height: number;
  x: number;
}

export interface PackedAtlas {
  file: string;
  width: number;
  height: number;
  sha256: string;
  png: Buffer;
}

/**
 * Simple shelf/row packer: sort by height descending, place left-to-right,
 * open a new shelf when the row is full. Atlases capped at ATLAS_MAX.
 */
export async function packAtlases(
  frames: RegisteredFrame[],
  outDir: string,
): Promise<{ atlases: AtlasMeta[]; manifestAtlases: PackedAtlas[]; frames: FrameMeta[] }> {
  await mkdir(outDir, { recursive: true });

  const indexed = frames.map((f, i) => ({ f, i }));
  indexed.sort((a, b) => b.f.meta.h - a.f.meta.h || b.f.meta.w - a.f.meta.w);

  type Placement = {
    frameIndex: number;
    atlas: number;
    x: number;
    y: number;
    w: number;
    h: number;
    rgba: Buffer;
  };
  const placements: Placement[] = [];
  const atlasSizes: { w: number; h: number }[] = [];

  let atlasIndex = 0;
  let shelves: Shelf[] = [];
  let atlasW = 0;
  let atlasH = 0;

  const startAtlas = () => {
    shelves = [];
    atlasW = 0;
    atlasH = 0;
  };
  startAtlas();

  const placeOne = (frameIndex: number, w: number, h: number, rgba: Buffer): boolean => {
    // Try existing shelves
    for (const shelf of shelves) {
      if (h > shelf.height) continue;
      if (shelf.x + w > ATLAS_MAX) continue;
      const x = shelf.x;
      const y = shelf.y;
      shelf.x += w;
      atlasW = Math.max(atlasW, shelf.x);
      atlasH = Math.max(atlasH, shelf.y + shelf.height);
      placements.push({ frameIndex, atlas: atlasIndex, x, y, w, h, rgba });
      return true;
    }
    // New shelf
    const y = atlasH === 0 && shelves.length === 0 ? 0 : atlasH;
    if (y + h > ATLAS_MAX) return false;
    if (w > ATLAS_MAX) throw new Error(`Frame ${w}x${h} exceeds atlas max`);
    shelves.push({ y, height: h, x: w });
    atlasW = Math.max(atlasW, w);
    atlasH = Math.max(atlasH, y + h);
    placements.push({ frameIndex, atlas: atlasIndex, x: 0, y, w, h, rgba });
    return true;
  };

  for (const { f, i } of indexed) {
    const w = f.meta.w;
    const h = f.meta.h;
    const rgba = f.rgba;
    if (!rgba) throw new Error(`Frame ${i} missing pixel buffer before pack`);
    if (!placeOne(i, w, h, rgba)) {
      atlasSizes.push({ w: atlasW, h: atlasH });
      atlasIndex++;
      startAtlas();
      if (!placeOne(i, w, h, rgba)) {
        throw new Error(`Cannot place frame ${w}x${h} even in empty atlas`);
      }
    }
  }
  if (placements.some((p) => p.atlas === atlasIndex)) {
    atlasSizes.push({ w: atlasW, h: atlasH });
  }

  const byAtlas = new Map<number, Placement[]>();
  for (const p of placements) {
    let list = byAtlas.get(p.atlas);
    if (!list) {
      list = [];
      byAtlas.set(p.atlas, list);
    }
    list.push(p);
  }

  const atlases: AtlasMeta[] = [];
  const manifestAtlases: PackedAtlas[] = [];
  const frameMetas: FrameMeta[] = frames.map((f) => ({ ...f.meta }));

  for (let a = 0; a < atlasSizes.length; a++) {
    const size = atlasSizes[a];
    if (!size) continue;
    const list = byAtlas.get(a) ?? [];
    // Pad to at least 1x1
    const width = Math.max(1, size.w);
    const height = Math.max(1, size.h);
    const composites: sharp.OverlayOptions[] = [];
    for (const p of list) {
      if (p.w === 0 || p.h === 0) continue;
      composites.push({
        input: await sharp(p.rgba, { raw: { width: p.w, height: p.h, channels: 4 } })
          .png()
          .toBuffer(),
        left: p.x,
        top: p.y,
      });
      const meta = frameMetas[p.frameIndex];
      if (!meta) continue;
      meta.a = a;
      meta.x = p.x;
      meta.y = p.y;
      meta.w = p.w;
      meta.h = p.h;
    }

    let png: Buffer;
    const bg = { r: 0, g: 0, b: 0, alpha: 0 };
    if (composites.length === 0) {
      png = await sharp({
        create: { width, height, channels: 4, background: bg },
      })
        .png()
        .toBuffer();
    } else {
      png = await sharp({
        create: { width, height, channels: 4, background: bg },
      })
        .composite(composites)
        .png()
        .toBuffer();
    }

    const file = `atlas-${a}.png`;
    const outPath = path.join(outDir, file);
    await writeFile(outPath, png);
    const sha256 = createHash("sha256").update(png).digest("hex");
    atlases.push({ file, width, height });
    manifestAtlases.push({ file, width, height, sha256, png });
    console.log(
      `pack: ${file} ${width}x${height} (${(png.byteLength / 1024).toFixed(0)} KB, ${list.length} frames)`,
    );
  }

  // Clear pixel buffers
  for (const f of frames) f.rgba = undefined;

  return { atlases, manifestAtlases, frames: frameMetas };
}
