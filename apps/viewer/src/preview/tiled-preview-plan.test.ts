import type { AssetSource, AssetTier, Blueprint, FrameMeta, RenderDb } from "fpsr";
import { describe, expect, it, vi } from "vite-plus/test";
import { createTiledPreviewTierPlanCache } from "./tiled-preview-plan";

const frame: FrameMeta = {
  a: 0,
  x: 0,
  y: 0,
  w: 32,
  h: 32,
  ox: 0,
  oy: 0,
  sw: 32,
  sh: 32,
};

const dbForFrame = (entityFrame: number, density: 1 | 2): RenderDb => ({
  schema: 2,
  gameVersion: "2.1.11",
  mods: ["base"],
  assetDensity: density,
  atlases: [{ file: "atlas.png", width: 64, height: 64 }],
  frames: [frame, { ...frame, x: 32 }],
  entities: {
    "wooden-chest": {
      kind: "simple",
      protoType: "container",
      collisionBox: [
        [-0.4, -0.4],
        [0.4, 0.4],
      ],
      selectionBox: [
        [-0.5, -0.5],
        [0.5, 0.5],
      ],
      graphics: [
        {
          layer: "object",
          indexing: "single",
          variants: {
            default: [{ frame: entityFrame, scale: 0.5, shift: [0, 0] }],
          },
        },
      ],
    },
  },
  tiles: {},
  icons: {},
});

describe("tiled preview tier planning", () => {
  it("plans each LOD against the render-db used by its atlas tier", async () => {
    const db1x = dbForFrame(1, 1);
    const db2x = dbForFrame(0, 2);
    const loadRenderDb = vi.fn<(tier?: AssetTier) => Promise<RenderDb>>(async (tier = "2x") =>
      tier === "1x" ? db1x : db2x,
    );
    const assets: AssetSource = {
      loadRenderDb,
      loadAtlasImage: vi.fn<() => Promise<CanvasImageSource>>(),
    };
    const blueprint: Blueprint = {
      item: "blueprint",
      version: 0,
      entities: [{ entity_number: 1, name: "wooden-chest", position: { x: 0.5, y: 0.5 } }],
    };
    const getTierPlan = createTiledPreviewTierPlanCache(assets, blueprint, {});

    const [plan1x, plan2x, repeated1x] = await Promise.all([
      getTierPlan("1x"),
      getTierPlan("2x"),
      getTierPlan("1x"),
    ]);
    const spriteFrames = (plan: typeof plan1x) =>
      plan.drawList.commands.flatMap((command) =>
        command.kind === "sprite" ? [command.frame] : [],
      );

    expect(plan1x.db).toBe(db1x);
    expect(plan2x.db).toBe(db2x);
    expect(repeated1x).toBe(plan1x);
    expect(spriteFrames(plan1x)).toContain(1);
    expect(spriteFrames(plan2x)).toContain(0);
    expect(loadRenderDb).toHaveBeenCalledTimes(2);
  });
});
