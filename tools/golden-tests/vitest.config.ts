import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const fpsrAliases = [
  { find: /^fpsr\/planner$/, replacement: path.join(repoRoot, "packages/renderer/src/planner.ts") },
  { find: /^fpsr\/canvas$/, replacement: path.join(repoRoot, "packages/renderer/src/canvas.ts") },
  {
    find: /^fpsr\/render-db$/,
    replacement: path.join(repoRoot, "packages/renderer/src/render-db.ts"),
  },
  { find: /^fpsr\/node$/, replacement: path.join(repoRoot, "packages/renderer/src/node.ts") },
  { find: /^fpsr$/, replacement: path.join(repoRoot, "packages/renderer/src/index.ts") },
];

export default defineConfig({
  resolve: {
    alias: fpsrAliases,
  },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
