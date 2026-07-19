import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: [
      "src/index.ts",
      "src/planner.ts",
      "src/canvas.ts",
      "src/render-db.ts",
      "src/node.ts",
      "src/node-browser.ts",
      "src/unstable-prepared-viewport.ts",
    ],
    format: ["esm"],
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
