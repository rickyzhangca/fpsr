import type { SpriteCmd } from "../types/draw-list.js";
import type { FrameMeta, TileMaterialAtlas } from "../types/render-db.js";

/**
 * Deterministic integer hash of tile coordinates for picking among tile frame
 * variants. Stable across runs / platforms for the same (x, y).
 */
export function tileVariantHash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Positive modulo for tile grid coordinates (handles negatives). */
export function tileMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function materialVariantOrigin(
  variantIdx: number,
  material: TileMaterialAtlas,
): { x: number; y: number } {
  const patchPxW = material.patchW * material.tilePx;
  const patchPxH = material.patchH * material.tilePx;
  const lineLength = material.lineLength ?? 0;
  const sheetX = material.sheetX ?? 0;
  const sheetY = material.sheetY ?? 0;
  if (lineLength > 0) {
    return {
      x: sheetX + (variantIdx % lineLength) * patchPxW,
      y: sheetY + Math.floor(variantIdx / lineLength) * patchPxH,
    };
  }
  return { x: sheetX + variantIdx * patchPxW, y: sheetY };
}

export function planMaterialTileSprite(
  tx: number,
  ty: number,
  material: TileMaterialAtlas,
  layer: number,
  frames: FrameMeta[],
): SpriteCmd | null {
  const { patchW, patchH, tilePx, count } = material;
  const bx = Math.floor(tx / patchW) * patchW;
  const by = Math.floor(ty / patchH) * patchH;
  const frameId = material.sheet;
  const frame = frames[frameId];
  if (!frame) return null;
  const variantIdx = tileVariantHash(bx, by) % count;
  const patchOrigin = materialVariantOrigin(variantIdx, material);
  const lx = tileMod(tx, patchW);
  const ly = tileMod(ty, patchH);
  return {
    kind: "sprite",
    layer,
    sortY: 0,
    sortX: 0,
    entity: 0,
    sub: 0,
    frame: frameId,
    x: tx,
    y: ty,
    w: 1,
    h: 1,
    src: {
      x: patchOrigin.x + lx * tilePx,
      y: patchOrigin.y + ly * tilePx,
      w: tilePx,
      h: tilePx,
    },
  };
}
