import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { discoverFactorioInstall } from "../src/paths.js";

describe("Factorio installation discovery", () => {
  it("derives the version, data directory, and executable from an explicit root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fpsr-factorio-"));
    try {
      await mkdir(path.join(root, "data/base"), { recursive: true });
      await mkdir(path.join(root, "bin/x64"), { recursive: true });
      await writeFile(path.join(root, "data/base/info.json"), JSON.stringify({ version: "9.8.7" }));
      const executable = path.join(root, "bin/x64/factorio");
      await writeFile(executable, "");
      await chmod(executable, 0o755);

      expect(discoverFactorioInstall(root)).toEqual({
        root,
        binary: executable,
        data: path.join(root, "data"),
        version: "9.8.7",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
