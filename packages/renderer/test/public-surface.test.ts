import { describe, expect, it } from "vite-plus/test";

const ENTRIES = [
  [".", "../src/index.js"],
  ["./planner", "../src/planner.js"],
  ["./canvas", "../src/canvas.js"],
  ["./node", "../src/node.js"],
  ["./unstable-prepared-viewport", "../src/unstable-prepared-viewport.js"],
] as const;

describe("public export surface", () => {
  for (const [subpath, modulePath] of ENTRIES) {
    it(`freezes value exports for ${subpath}`, async () => {
      const mod = await import(modulePath);
      expect(Object.keys(mod).sort()).toMatchSnapshot(subpath);
    });
  }
});
