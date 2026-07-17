import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^fpsr\/node$/, replacement: path.join(repoRoot, "packages/renderer/src/node.ts") },
      { find: /^fpsr$/, replacement: path.join(repoRoot, "packages/renderer/src/index.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
