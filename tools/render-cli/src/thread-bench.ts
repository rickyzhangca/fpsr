#!/usr/bin/env tsx

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { Canvas } from "skia-canvas";
import { createRenderer, decode, type CanvasLike, type RenderOptions } from "fpsr";
import { localAssets } from "fpsr/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const resolveFromRoot = (value: string | undefined, fallback: string) =>
  value == null ? path.join(repoRoot, fallback) : path.resolve(repoRoot, value);
const input = resolveFromRoot(args[0], "temp.txt");
const assets = resolveFromRoot(args[1], "assets-out/2.1.11");
const pixelsPerTile = 64;
const iterations = 3;
const heartbeatMs = 2;

interface Measurement {
  renderMs: number;
  paintMs: number;
  maxEventLoopDelayMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function withHeartbeat(
  action: () => Promise<{ renderMs: number; paintMs: number }>,
): Promise<Measurement> {
  let previous = performance.now();
  let maxDelay = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxDelay = Math.max(maxDelay, now - previous - heartbeatMs);
    previous = now;
  }, heartbeatMs);
  await new Promise((resolve) => setTimeout(resolve, heartbeatMs * 3));
  const result = await action();
  await new Promise((resolve) => setTimeout(resolve, heartbeatMs * 3));
  clearInterval(timer);
  return { ...result, maxEventLoopDelayMs: Math.max(0, maxDelay) };
}

function summarize(label: string, values: Measurement[]): void {
  console.log(
    `${label.padEnd(12)} render ${median(values.map((x) => x.renderMs)).toFixed(1)}ms  ` +
      `paint ${median(values.map((x) => x.paintMs)).toFixed(1)}ms  ` +
      `main-thread stall ${median(values.map((x) => x.maxEventLoopDelayMs)).toFixed(1)}ms`,
  );
}

const source = (await readFile(input, "utf8")).trim();
const doc = decode(source);
const mainCanvas = new Canvas(1, 1) as unknown as CanvasLike;
const renderer = await createRenderer({
  assets: localAssets(assets),
  createCanvas: (width, height) => new Canvas(width, height) as unknown as CanvasLike,
});
const options: RenderOptions = {
  pixelsPerTile,
  altMode: true,
  background: { type: "none" },
  profile: true,
  canvas: mainCanvas,
};
await renderer.render(doc, options);

const mainMeasurements: Measurement[] = [];
for (let i = 0; i < iterations; i++) {
  mainMeasurements.push(
    await withHeartbeat(async () => {
      const result = await renderer.render(doc, options);
      return {
        renderMs: result.profile?.totalMs ?? 0,
        paintMs: result.profile?.paintMs ?? 0,
      };
    }),
  );
}

const worker = new Worker(new URL("./thread-bench-worker.mjs", import.meta.url), {
  workerData: { source, assets, pixelsPerTile },
});
await new Promise<void>((resolve, reject) => {
  const onMessage = (message: { type: string }) => {
    if (message.type !== "ready") return;
    worker.off("error", reject);
    worker.off("message", onMessage);
    resolve();
  };
  worker.on("message", onMessage);
  worker.once("error", reject);
});

let nextRequestId = 1;
const renderInWorker = (): Promise<{ renderMs: number; paintMs: number }> => {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const onMessage = (message: {
      type: string;
      requestId?: number;
      totalMs?: number;
      paintMs?: number;
      message?: string;
    }) => {
      if (message.requestId !== requestId) return;
      worker.off("message", onMessage);
      if (message.type === "error") reject(new Error(message.message));
      else resolve({ renderMs: message.totalMs ?? 0, paintMs: message.paintMs ?? 0 });
    };
    worker.on("message", onMessage);
    worker.postMessage({ type: "render", requestId });
  });
};

const workerMeasurements: Measurement[] = [];
for (let i = 0; i < iterations; i++) {
  workerMeasurements.push(await withHeartbeat(renderInWorker));
}
await worker.terminate();

console.log(
  `Blueprint: ${path.relative(repoRoot, input)} · ${pixelsPerTile} px/tile · ${iterations} warm runs`,
);
summarize("main thread", mainMeasurements);
summarize("worker", workerMeasurements);
console.log(
  `stall reduction ${(median(mainMeasurements.map((x) => x.maxEventLoopDelayMs)) / Math.max(0.001, median(workerMeasurements.map((x) => x.maxEventLoopDelayMs)))).toFixed(1)}×`,
);
