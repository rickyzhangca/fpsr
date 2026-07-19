import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { collectFiles, contentTypeFor, resolveAssetsDir, uploadFile } from "./cli.js";

const manifest = {
  schema: 2 as const,
  gameVersion: "2.1.11",
  mods: ["base"],
  tiers: {
    "1x": {
      density: 1 as const,
      renderDb: { file: "render-db.one.json", sha256: "one" },
      atlases: [{ file: "atlas.one.webp", w: 1, h: 1, sha256: "one" }],
    },
    "2x": {
      density: 2 as const,
      renderDb: { file: "render-db.two.json", sha256: "two" },
      atlases: [{ file: "atlas.two.webp", w: 2, h: 2, sha256: "two" }],
    },
  },
};

describe("CDN upload ordering", () => {
  it("always publishes the stable manifest after hashed content", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fpsr-upload-"));
    try {
      await mkdir(dir, { recursive: true });
      await Promise.all([
        writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest)),
        writeFile(path.join(dir, "atlas.one.webp"), "atlas"),
        writeFile(path.join(dir, "atlas.two.webp"), "atlas"),
        writeFile(path.join(dir, "render-db.one.json"), "db"),
        writeFile(path.join(dir, "render-db.two.json"), "db"),
        writeFile(path.join(dir, "distill-report.json"), "not public"),
      ]);
      const files = await collectFiles(dir);
      expect(files.map((file) => file.relativePath)).toEqual([
        "atlas.one.webp",
        "atlas.two.webp",
        "render-db.one.json",
        "render-db.two.json",
        "manifest.json",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("CDN upload paths", () => {
  it("resolves documented relative asset paths from the repository root", () => {
    expect(resolveAssetsDir("assets-out/2.1.11")).toMatch(/fpsr\/assets-out\/2\.1\.11$/);
  });
});

describe("CDN upload retries", () => {
  it("retries transient responses and then succeeds", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fpsr-upload-retry-"));
    try {
      const absolutePath = path.join(dir, "atlas.one.webp");
      await writeFile(absolutePath, "atlas");
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 201 }));
      const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);

      await uploadFile(
        { zone: "fpsr", host: "storage.bunnycdn.com", apiKey: "secret" },
        "2.1.11",
        { relativePath: "atlas.one.webp", absolutePath, size: 5 },
        { fetchImpl, wait, maxAttempts: 2 },
      );

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not retry permanent client errors", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fpsr-upload-error-"));
    try {
      const absolutePath = path.join(dir, "manifest.json");
      await writeFile(absolutePath, "{}");
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("bad", { status: 400 }));

      await expect(
        uploadFile(
          { zone: "fpsr", host: "storage.bunnycdn.com", apiKey: "secret" },
          "2.1.11",
          { relativePath: "manifest.json", absolutePath, size: 2 },
          { fetchImpl, maxAttempts: 4 },
        ),
      ).rejects.toThrow("HTTP 400");
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("CDN upload content types", () => {
  it("serves generated WebP atlases as images", () => {
    expect(contentTypeFor("atlas.abc.webp")).toBe("image/webp");
    expect(contentTypeFor("atlas.abc.png")).toBe("image/png");
    expect(contentTypeFor("manifest.json")).toBe("application/json");
    expect(contentTypeFor("unknown.bin")).toBe("application/octet-stream");
  });
});
