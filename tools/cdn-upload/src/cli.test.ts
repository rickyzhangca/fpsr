import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { collectFiles } from "./cli.js";

describe("CDN upload ordering", () => {
  it("always publishes the stable manifest after hashed content", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fpsr-upload-"));
    try {
      await mkdir(dir, { recursive: true });
      await Promise.all([
        writeFile(path.join(dir, "manifest.json"), "{}"),
        writeFile(path.join(dir, "atlas.abc.png"), "atlas"),
        writeFile(path.join(dir, "render-db.def.json"), "db"),
      ]);
      const files = await collectFiles(dir);
      expect(files.map((file) => file.relativePath)).toEqual([
        "atlas.abc.png",
        "render-db.def.json",
        "manifest.json",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
