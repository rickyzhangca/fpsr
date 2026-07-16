import { type CanvasLike, createRenderer, decode } from "fpsr";
import { localAssets } from "fpsr/node";
import { readFile } from "node:fs/promises";
import { Canvas } from "skia-canvas";
import { type GoldenCase, bpPath } from "./cases.js";

export async function renderCase(c: GoldenCase, assetsDir: string): Promise<Buffer> {
  const source = await readFile(bpPath(c), "utf8");
  const doc = decode(source.trim());
  const renderer = await createRenderer({
    assets: localAssets(assetsDir),
    createCanvas: (width, height) => new Canvas(width, height) as unknown as CanvasLike,
  });

  const result = await renderer.render(doc, {
    pixelsPerTile: c.ppt,
    altMode: c.alt ?? true,
    showCheckerboard: false,
    background: null,
  });

  return Buffer.from(await result.toPngBuffer());
}
