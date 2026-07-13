import { createHash } from "node:crypto";
import type { CroppedFrame } from "./sprite.js";
import { trimRgba } from "./sprite.js";

export type BeltFrameSplit = {
  clean: CroppedFrame;
  wireHorizontal: CroppedFrame | null;
  wireVertical: CroppedFrame | null;
};

function isCreamPeg(r: number, g: number, b: number): boolean {
  return r > 170 && g > 150 && b > 130 && Math.abs(r - g) < 55 && (r + g + b) / 3 > 160;
}

/** Red/green coiled décor wires (not yellow cage, not cream pegs). */
function isWirePaint(r: number, g: number, b: number): boolean {
  if (r > 90 && r > g + 25 && r > b + 25 && g < 110 && b < 110) return true;
  if (g > 90 && g > r + 15 && g > b + 15 && r < 160) return true;
  return false;
}

async function toCropped(
  rgba: Buffer,
  tw: number,
  th: number,
  sw: number,
  sh: number,
  baseOx: number,
  baseOy: number,
): Promise<CroppedFrame> {
  const trimmed = await trimRgba(rgba, tw, th);
  if (trimmed.tw === 0 || trimmed.th === 0) {
    const empty = Buffer.from([0, 0, 0, 0]);
    return {
      sw,
      sh,
      ox: 0,
      oy: 0,
      rgba: empty,
      tw: 1,
      th: 1,
      hash: createHash("sha256").update(empty).digest("hex"),
    };
  }
  const hash = createHash("sha256").update(trimmed.rgba).digest("hex");
  return {
    sw,
    sh,
    ox: baseOx + trimmed.ox,
    oy: baseOy + trimmed.oy,
    rgba: trimmed.rgba,
    tw: trimmed.tw,
    th: trimmed.th,
    hash,
  };
}

/**
 * Factorio bakes cage + pegs + H/V décor wires into one `frame_main` cell.
 * The engine masks décor at runtime; we recreate that split:
 * - clean: yellow cage + cream connection pegs (always drawn when wired)
 * - wireHorizontal: décor near red/green LED offset (output / enable)
 * - wireVertical: décor near blue LED offset (input / read)
 */
export async function splitBeltFrameMain(
  src: CroppedFrame,
  opts: {
    shift: [number, number];
    scale: number;
    blueOffset: [number, number];
    rgOffset: [number, number];
  },
): Promise<BeltFrameSplit> {
  const { tw, th, sw, sh, ox, oy, rgba } = src;
  const peg = new Uint8Array(tw * th);
  const wire = new Uint8Array(tw * th);

  for (let py = 0; py < th; py++) {
    for (let px = 0; px < tw; px++) {
      const i = (py * tw + px) * 4;
      const a = rgba[i + 3] ?? 0;
      if (a < 16) continue;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      if (isCreamPeg(r, g, b)) peg[py * tw + px] = 1;
      else if (isWirePaint(r, g, b)) wire[py * tw + px] = 1;
    }
  }

  // Peg tips / local stubs: wire paint within 3px of cream stays on the cage.
  const pegDilated = new Uint8Array(peg);
  for (let pass = 0; pass < 3; pass++) {
    const snapshot = Uint8Array.from(pegDilated);
    for (let py = 0; py < th; py++) {
      for (let px = 0; px < tw; px++) {
        const idx = py * tw + px;
        if (snapshot[idx] || !wire[idx]) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
            if (snapshot[ny * tw + nx]) near = true;
          }
        }
        if (near) pegDilated[idx] = 1;
      }
    }
  }

  const clean = Buffer.from(rgba);
  const wireH = Buffer.alloc(rgba.length);
  const wireV = Buffer.alloc(rgba.length);
  let nH = 0;
  let nV = 0;

  for (let py = 0; py < th; py++) {
    for (let px = 0; px < tw; px++) {
      const idx = py * tw + px;
      if (!wire[idx] || pegDilated[idx]) continue;
      const i = idx * 4;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      const a = rgba[i + 3] ?? 0;

      const srcX = px + ox;
      const srcY = py + oy;
      const tileX = opts.shift[0] + ((srcX - sw / 2) * opts.scale) / 32;
      const tileY = opts.shift[1] + ((srcY - sh / 2) * opts.scale) / 32;
      const dBlue = Math.hypot(tileX - opts.blueOffset[0], tileY - opts.blueOffset[1]);
      const dRg = Math.hypot(tileX - opts.rgOffset[0], tileY - opts.rgOffset[1]);

      clean[i] = 0;
      clean[i + 1] = 0;
      clean[i + 2] = 0;
      clean[i + 3] = 0;
      if (dRg <= dBlue) {
        wireH[i] = r;
        wireH[i + 1] = g;
        wireH[i + 2] = b;
        wireH[i + 3] = a;
        nH++;
      } else {
        wireV[i] = r;
        wireV[i + 1] = g;
        wireV[i + 2] = b;
        wireV[i + 3] = a;
        nV++;
      }
    }
  }

  const cleanCrop = await toCropped(clean, tw, th, sw, sh, ox, oy);
  const wireHorizontal = nH > 0 ? await toCropped(wireH, tw, th, sw, sh, ox, oy) : null;
  const wireVertical = nV > 0 ? await toCropped(wireV, tw, th, sw, sh, ox, oy) : null;
  return { clean: cleanCrop, wireHorizontal, wireVertical };
}

export function asOffset2(v: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") {
    return [v[0], v[1]];
  }
  return fallback;
}
