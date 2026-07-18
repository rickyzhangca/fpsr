import type {
  EntityRenderDef,
  FrameMeta,
  LayerGroup,
  RenderDb,
  SpriteVariant,
} from "../../src/types/render-db.js";

/** 64×64 fpsr-owned unsupported-entity marker (1 tile at scale 0.5). */
const UNSUPPORTED_MARKER_FRAME: FrameMeta = {
  a: 0,
  x: 0,
  y: 0,
  w: 64,
  h: 64,
  ox: 0,
  oy: 0,
  sw: 64,
  sh: 64,
};

/** Shared 32×32 frame in a fake 64×64 atlas (untrimmed = trimmed). */
const FRAME0: FrameMeta = {
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

/** Frame with trim inset for dest-rect / canvas tests. */
export const TRIMMED_FRAME: FrameMeta = {
  a: 0,
  x: 4,
  y: 6,
  w: 24,
  h: 20,
  ox: 4,
  oy: 6,
  sw: 32,
  sh: 32,
};

/** 8×8 material patch (64×64 untrimmed) for tile atlas tests. */
export const MATERIAL_PATCH_FRAME: FrameMeta = {
  a: 0,
  x: 0,
  y: 0,
  w: 64,
  h: 64,
  ox: 0,
  oy: 0,
  sw: 64,
  sh: 64,
};

function variant(frame: number, opts?: Partial<SpriteVariant>): SpriteVariant {
  return {
    frame,
    scale: 0.5,
    shift: [0, 0],
    ...opts,
  };
}

function direction4Group(
  layer: LayerGroup["layer"],
  frame = 0,
  extra?: Partial<SpriteVariant>,
): LayerGroup {
  return {
    layer,
    indexing: "direction4",
    variants: {
      default: [0, 1, 2, 3].map(() => variant(frame, extra)),
    },
  };
}

function singleGroup(
  layer: LayerGroup["layer"],
  frame = 0,
  extra?: Partial<SpriteVariant>,
): LayerGroup {
  return {
    layer,
    indexing: "single",
    variants: {
      default: [variant(frame, extra)],
    },
  };
}

function pipeMasks(): Record<string, (SpriteVariant | null)[]> {
  const out: Record<string, (SpriteVariant | null)[]> = {};
  for (let i = 0; i < 16; i++) {
    // NESW bit order: bit3=N, bit2=E, bit1=S, bit0=W.
    const n = (i >> 3) & 1;
    const e = (i >> 2) & 1;
    const s = (i >> 1) & 1;
    const w = i & 1;
    out[`${n}${e}${s}${w}`] = [variant(0)];
  }
  return out;
}

function wallMasks(): Record<string, (SpriteVariant | null)[]> {
  return pipeMasks();
}

function beltVariants(): (SpriteVariant | null)[] {
  return Array.from({ length: 20 }, () => variant(0));
}

const woodenChest: EntityRenderDef = {
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
    singleGroup("object", 0),
    singleGroup("shadow", 0, { drawAsShadow: true, shift: [0.1, 0.1] }),
  ],
};

const inserterLike: EntityRenderDef = {
  kind: "simple",
  protoType: "inserter",
  collisionBox: [
    [-0.15, -0.15],
    [0.15, 0.15],
  ],
  selectionBox: [
    [-0.4, -0.4],
    [0.4, 0.4],
  ],
  graphics: [direction4Group("object", 0)],
};

const pipe: EntityRenderDef = {
  kind: "pipe",
  protoType: "pipe",
  collisionBox: [
    [-0.3, -0.3],
    [0.3, 0.3],
  ],
  selectionBox: [
    [-0.5, -0.5],
    [0.5, 0.5],
  ],
  graphics: [
    {
      layer: "object",
      indexing: "single",
      variants: pipeMasks(),
    },
  ],
};

const stoneWall: EntityRenderDef = {
  kind: "wall",
  protoType: "wall",
  collisionBox: [
    [-0.3, -0.3],
    [0.3, 0.3],
  ],
  selectionBox: [
    [-0.5, -0.5],
    [0.5, 0.5],
  ],
  graphics: [
    {
      layer: "object",
      indexing: "single",
      variants: wallMasks(),
    },
  ],
};

const transportBelt: EntityRenderDef = {
  kind: "belt",
  protoType: "transport-belt",
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
      layer: "transport-belt",
      indexing: "resolver",
      variants: {
        default: beltVariants(),
      },
    },
  ],
};

const undergroundBelt: EntityRenderDef = {
  kind: "underground-belt",
  protoType: "underground-belt",
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
      indexing: "direction4",
      variants: {
        in: [0, 1, 2, 3].map(() => variant(0)),
        out: [0, 1, 2, 3].map(() => variant(0, { flipY: true })),
      },
    },
  ],
};

const assembler: EntityRenderDef = {
  kind: "assembler",
  protoType: "assembling-machine",
  collisionBox: [
    [-1.2, -1.2],
    [1.2, 1.2],
  ],
  selectionBox: [
    [-1.5, -1.5],
    [1.5, 1.5],
  ],
  graphics: [singleGroup("object", 0)],
};

const inserter: EntityRenderDef = {
  kind: "inserter",
  protoType: "inserter",
  collisionBox: [
    [-0.15, -0.15],
    [0.15, 0.15],
  ],
  selectionBox: [
    [-0.4, -0.4],
    [0.4, 0.4],
  ],
  graphics: [
    direction4Group("floor", 0),
    direction4Group("higher-object-under", 1),
    direction4Group("higher-object-under", 2),
  ],
};

const gate: EntityRenderDef = {
  kind: "gate",
  protoType: "gate",
  collisionBox: [
    [-0.3, -0.3],
    [0.3, 0.3],
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
        horizontal: [variant(0)],
        vertical: [variant(0)],
      },
    },
  ],
};

const boiler: EntityRenderDef = {
  kind: "simple",
  protoType: "boiler",
  collisionBox: [
    [-1.3, -0.9],
    [1.3, 0.9],
  ],
  selectionBox: [
    [-1.5, -1],
    [1.5, 1],
  ],
  graphics: [direction4Group("object", 0)],
  data: {
    // Pipe-tile offsets relative to center when facing north (dir 0).
    fluidConnections: {
      "0": [
        [-2, 0.5],
        [2, 0.5],
        [0, -1.5],
      ],
      "4": [
        [-0.5, -2],
        [-0.5, 2],
        [1.5, 0],
      ],
      "8": [
        [2, -0.5],
        [-2, -0.5],
        [0, 1.5],
      ],
      "12": [
        [0.5, 2],
        [0.5, -2],
        [-1.5, 0],
      ],
    },
  },
};

const storageTank: EntityRenderDef = {
  kind: "simple",
  protoType: "storage-tank",
  collisionBox: [
    [-1.3, -1.3],
    [1.3, 1.3],
  ],
  selectionBox: [
    [-1.5, -1.5],
    [1.5, 1.5],
  ],
  graphics: [direction4Group("object", 0)],
  data: {
    fluidConnections: {
      "0": [
        [-1, -2],
        [2, 1],
        [1, 2],
        [-2, -1],
      ],
      "4": [
        [2, -1],
        [1, 2],
        [-2, 1],
        [-1, -2],
      ],
      "8": [
        [1, 2],
        [-2, -1],
        [-1, -2],
        [2, 1],
      ],
      "12": [
        [-2, 1],
        [-1, -2],
        [2, -1],
        [1, 2],
      ],
    },
  },
};

const pump: EntityRenderDef = {
  kind: "simple",
  protoType: "pump",
  collisionBox: [
    [-0.3, -0.9],
    [0.3, 0.9],
  ],
  selectionBox: [
    [-0.5, -1],
    [0.5, 1],
  ],
  graphics: [direction4Group("object", 0)],
  data: {
    fluidConnections: {
      "0": [
        [0, -1.5],
        [0, 1.5],
      ],
      "4": [
        [1.5, 0],
        [-1.5, 0],
      ],
      "8": [
        [0, 1.5],
        [0, -1.5],
      ],
      "12": [
        [-1.5, 0],
        [1.5, 0],
      ],
    },
  },
};

const heatPipe: EntityRenderDef = {
  kind: "heat-pipe",
  protoType: "heat-pipe",
  collisionBox: [
    [-0.3, -0.3],
    [0.3, 0.3],
  ],
  selectionBox: [
    [-0.5, -0.5],
    [0.5, 0.5],
  ],
  graphics: [
    {
      layer: "object",
      indexing: "single",
      variants: pipeMasks(),
    },
  ],
  data: {
    heatConnections: {
      "0": [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
      "4": [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
      "8": [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
      "12": [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
    },
  },
};

/** Known dest-rect entity: scale 0.5, sw/sh 32 → 0.5×0.5 tiles, shift [0.25, -0.125]. */
export const DEST_MATH_FRAME: FrameMeta = {
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

const destMathEntity: EntityRenderDef = {
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
  graphics: [
    {
      layer: "object",
      indexing: "single",
      variants: {
        default: [
          {
            frame: 1, // DEST_MATH_FRAME / TRIMMED index — frames[1]
            scale: 0.5,
            shift: [0.25, -0.125],
          },
        ],
      },
    },
  ],
};

const flipEntity: EntityRenderDef = {
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
        default: [variant(2, { flipX: true })], // TRIMMED_FRAME at index 2
      },
    },
  ],
};

/**
 * Hand-written RenderDb for unit tests. Atlas is conceptual 64×64; all frames
 * may share the same rect. frames[0]=plain, [1]=dest-math, [2]=trimmed, [3]=icon.
 */
export function makeMiniDb(): RenderDb {
  return {
    schema: 2,
    gameVersion: "2.1.11",
    mods: ["base"],
    atlases: [{ file: "atlas-0.png", width: 64, height: 64 }],
    frames: [
      FRAME0,
      DEST_MATH_FRAME,
      TRIMMED_FRAME,
      { ...FRAME0, x: 32, y: 0 }, // icon
      UNSUPPORTED_MARKER_FRAME,
      MATERIAL_PATCH_FRAME,
    ],
    entities: {
      "wooden-chest": woodenChest,
      "inserter-like": inserterLike,
      inserter,
      pipe,
      "stone-wall": stoneWall,
      gate,
      boiler,
      "storage-tank": storageTank,
      pump,
      "heat-pipe": heatPipe,
      "transport-belt": transportBelt,
      "underground-belt": undergroundBelt,
      "assembling-machine-1": assembler,
      "dest-math": destMathEntity,
      "flip-chest": flipEntity,
    },
    tiles: {
      "stone-path": {
        layer: "ground-tile",
        item: "stone-brick",
        color: [0.4, 0.35, 0.3, 1],
      },
      "concrete-framed": {
        layer: "ground-tile",
        color: [0.5, 0.5, 0.5, 1],
        material: {
          sheet: 5,
          count: 1,
          patchW: 8,
          patchH: 8,
          tilePx: 8,
        },
      },
    },
    terrainBackgrounds: {
      dirt: {
        patchSize: 4,
        frames: [0],
        weights: [1],
        color: [141 / 255, 104 / 255, 60 / 255, 1],
      },
      water: {
        patchSize: 4,
        frames: [0],
        color: [51 / 255, 83 / 255, 95 / 255, 1],
      },
      vulcanus: {
        patchSize: 4,
        frames: [0],
        color: [35 / 255, 38 / 255, 30 / 255, 1],
      },
      gleba: {
        patchSize: 4,
        frames: [0],
        color: [52 / 255, 55 / 255, 48 / 255, 1],
      },
      fulgora: {
        patchSize: 8,
        frames: [0],
        color: [112 / 255, 65 / 255, 50 / 255, 1],
      },
      aquilo: {
        patchSize: 4,
        frames: [0],
        color: [220 / 255, 230 / 255, 240 / 255, 1],
      },
    },
    spaceBackground: {
      planetFrame: 0,
      planets: { nauvis: 0, vulcanus: 2 },
    },
    icons: {
      "recipe/iron-gear-wheel": 3,
      "item/iron-plate": 3,
      "item/stone-brick": 3,
      "quality/rare": 3,
      "utility/unsupported-entity": 4,
    },
  };
}
