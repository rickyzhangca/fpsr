import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { packAtlases, type PackUsageInput } from "../src/atlas.js";
import type { RegisteredFrame } from "../src/sprite.js";
import type { EntityRenderDef, SpriteVariant } from "../src/types.js";

function frame(id: number, width: number, height: number): RegisteredFrame {
  const rgba = Buffer.alloc(width * height * 4);
  rgba.fill((id + 1) * 31);
  return {
    id,
    meta: { a: 0, x: 0, y: 0, w: width, h: height, ox: 0, oy: 0, sw: width, sh: height },
    rgba,
  };
}

function entity(...frames: number[]): EntityRenderDef {
  const variants: (SpriteVariant | null)[] = frames.map((id) => ({
    frame: id,
    scale: 1,
    shift: [0, 0],
  }));
  return {
    kind: "simple",
    protoType: "container",
    collisionBox: [
      [-0.5, -0.5],
      [0.5, 0.5],
    ],
    selectionBox: [
      [-0.5, -0.5],
      [0.5, 0.5],
    ],
    graphics: [{ layer: "object", indexing: "single", variants: { default: variants } }],
  };
}

function fixture(): { frames: RegisteredFrame[]; usage: PackUsageInput } {
  return {
    frames: [frame(0, 16, 16), frame(1, 1, 1), frame(2, 1, 1), frame(3, 1, 1)],
    usage: {
      entities: { alpha: entity(0, 1), beta: entity(1) },
      tiles: { stone: { layer: "ground-tile", color: [0, 0, 0, 1], frames: [3] } },
      icons: { "item/test": 2 },
    },
  };
}

describe("usage-aware atlas packing", () => {
  it("separates domains, clones low-owner world frames, and is deterministic", async () => {
    const firstDir = await mkdtemp(path.join(os.tmpdir(), "fpsr-atlas-a-"));
    const secondDir = await mkdtemp(path.join(os.tmpdir(), "fpsr-atlas-b-"));
    try {
      const firstFixture = fixture();
      const secondFixture = fixture();
      const first = await packAtlases(firstFixture.frames, firstFixture.usage, firstDir);
      const second = await packAtlases(secondFixture.frames, secondFixture.usage, secondDir);

      expect(first.atlases.length).toBeGreaterThanOrEqual(3);
      expect(first.atlases).toEqual(second.atlases);
      expect(first.frames).toEqual(second.frames);
      expect(first.manifestAtlases).toEqual(second.manifestAtlases);
      const alphaShared = firstFixture.usage.entities.alpha?.graphics[0]?.variants.default?.[1];
      const betaShared = firstFixture.usage.entities.beta?.graphics[0]?.variants.default?.[0];
      expect(alphaShared?.frame).not.toBe(betaShared?.frame);
      expect(first.stats.clonedPixelRatio).toBeLessThan(1.25);
      for (const atlas of first.manifestAtlases) {
        expect(await readFile(path.join(firstDir, atlas.file))).toEqual(
          await readFile(path.join(secondDir, atlas.file)),
        );
      }
    } finally {
      await rm(firstDir, { recursive: true, force: true });
      await rm(secondDir, { recursive: true, force: true });
    }
  });

  it("puts frames larger than 1024px on exact dedicated pages", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fpsr-atlas-large-"));
    try {
      const frames = [frame(0, 1025, 2)];
      const usage: PackUsageInput = { entities: { large: entity(0) }, tiles: {}, icons: {} };
      const packed = await packAtlases(frames, usage, dir);
      expect(packed.atlases).toEqual([expect.objectContaining({ width: 1025, height: 2 })]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails with a group report when cloning exceeds the storage ceiling", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fpsr-atlas-limit-"));
    try {
      const frames = [frame(0, 1, 1)];
      const usage: PackUsageInput = {
        entities: { alpha: entity(0), beta: entity(0) },
        tiles: {},
        icons: {},
      };
      await expect(packAtlases(frames, usage, dir)).rejects.toThrow("limit is 125%");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
