import { parentPort, workerData } from "node:worker_threads";
import { Canvas } from "skia-canvas";
import { createRenderer, decode } from "fpsr";
import { localAssets } from "fpsr/node";

const doc = decode(workerData.source);
const canvas = new Canvas(1, 1);
const renderer = await createRenderer({
  assets: localAssets(workerData.assets),
  createCanvas: (width, height) => new Canvas(width, height),
});
const options = {
  pixelsPerTile: workerData.pixelsPerTile,
  altMode: true,
  background: null,
  profile: true,
  canvas,
};

await renderer.render(doc, options);
parentPort.postMessage({ type: "ready" });

parentPort.on("message", async (message) => {
  if (message.type !== "render") return;
  try {
    const result = await renderer.render(doc, options);
    parentPort.postMessage({
      type: "rendered",
      requestId: message.requestId,
      totalMs: result.profile?.totalMs ?? 0,
      paintMs: result.profile?.paintMs ?? 0,
    });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
