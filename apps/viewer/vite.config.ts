import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const assetsRoot = path.join(repoRoot, "assets-out");

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".txt": "text/plain",
};

function serveDirectory(prefix: string, rootDir: string): Plugin {
  return {
    name: `fpsr-serve-${prefix.replace(/\//g, "-")}`,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!url?.startsWith(prefix)) {
          next();
          return;
        }

        const rel = decodeURIComponent(url.slice(prefix.length));
        const filePath = path.resolve(rootDir, rel);
        if (!filePath.startsWith(`${rootDir}${path.sep}`) && filePath !== rootDir) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: lazyPlugins(() => [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    serveDirectory("/assets/", assetsRoot),
  ]),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      fpsr: path.resolve(__dirname, "../../packages/renderer/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
  },
});
