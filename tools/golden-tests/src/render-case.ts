import { type CanvasLike, createRenderer, decode, type RenderOptions } from "fpsr";
import { localAssets } from "fpsr/node";
import { readFile } from "node:fs/promises";
import { Canvas } from "skia-canvas";
import { bpPath, type GoldenCase } from "./cases.js";

type SeamRenderOptions = Pick<RenderOptions, "background" | "showCoordinates">;

export async function renderCase(
  c: GoldenCase,
  assetsDir: string,
  options: SeamRenderOptions = {},
): Promise<Buffer> {
  const source = await readFile(bpPath(c), "utf8");
  const doc = decode(source.trim());
  const renderer = await createRenderer({
    assets: localAssets(assetsDir),
    createCanvas: (width, height) => new Canvas(width, height) as unknown as CanvasLike,
  });

  const result = await renderer.render(doc, {
    pixelsPerTile: c.ppt,
    altMode: c.alt,
    blueprintPath: c.blueprintPath,
    background: { type: "none" },
    ...options,
  });

  return Buffer.from(await result.toPngBuffer());
}

export async function renderTiledCase(
  c: GoldenCase,
  assetsDir: string,
  options: SeamRenderOptions = {},
): Promise<Buffer> {
  const source = await readFile(bpPath(c), "utf8");
  const doc = decode(source.trim());
  const renderer = await createRenderer({
    assets: localAssets(assetsDir),
    createCanvas: (width, height) => new Canvas(width, height) as unknown as CanvasLike,
  });
  const result = await renderer.renderTiledPng(doc, {
    pixelsPerTile: c.ppt,
    altMode: c.alt,
    blueprintPath: c.blueprintPath,
    background: { type: "none" },
    tileSize: 256,
    maxStripeBytes: 256 * 256 * 4,
    ...options,
  });
  return Buffer.from(await result.blob.arrayBuffer());
}
