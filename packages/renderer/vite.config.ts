import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/node.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
