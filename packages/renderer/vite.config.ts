import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/planner.ts", "src/canvas.ts", "src/render-db.ts", "src/node.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
