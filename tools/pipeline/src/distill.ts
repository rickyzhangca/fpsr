import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { packAtlases } from "./atlas.js";
import { asOffset2, splitBeltFrameMain } from "./belt-connector-split.js";
import {
  discoverPlaceableEntities,
  discoverPlaceableTiles,
  discoverTilePlacingItems,
} from "./discover.js";
import { UNSUPPORTED_ENTITY_PNG, getPipelinePaths, resolveSpritePath } from "./paths.js";
import { fpsrLayer, guessedLayer, officialLayer, railPieceLayerFromDump } from "./render-layers.js";
import {
  FrameBank,
  averageColor,
  clearImageCache,
  cropEntireFile,
  cropFileRect,
  cropSpriteFrame,
  dirs4,
  isSprite4Way,
  leafLayers,
  normalizeShift,
  normalizeTint,
  round4,
  scaleRegisteredFrames,
  spriteSize,
} from "./sprite.js";
import type {
  DataRaw,
  EntityKind,
  EntityRenderDef,
  LayerGroup,
  RawSprite,
  RenderDb,
  RenderLayerName,
  SpriteVariant,
  TileRenderDef,
} from "./types.js";
import { verifyAssetBundle } from "./verify.js";

/**
 * Layer assignment policy (see docs/RENDER_LAYERS.md):
 * - Prefer `officialLayer(...)` / dump fields when Factorio exposes them.
 * - Use `guessedLayer(...)` for engine-hardcoded bodies (not in dump).
 * - Use `fpsrLayer(...)` only for fpsr-invented names (shadow, ground-tile, …).
 */

const EMPTY_BOX: [[number, number], [number, number]] = [
  [0, 0],
  [0, 0],
];

function boxOf(proto: Record<string, unknown>, key: string): [[number, number], [number, number]] {
  const b = proto[key] as [[number, number], [number, number]] | undefined;
  if (!b) return EMPTY_BOX;
  return [
    [round4(b[0][0]), round4(b[0][1])],
    [round4(b[1][0]), round4(b[1][1])],
  ];
}

function proto(raw: DataRaw, type: string, name: string): Record<string, unknown> {
  const p = raw[type]?.[name];
  if (!p) throw new Error(`Missing prototype ${type}/${name}`);
  return p;
}

/** NESW bitmask "0000".."1111" → pipe picture key. */
const PIPE_MASK_KEYS: Record<string, string> = {
  "0000": "straight_vertical_single",
  "1000": "ending_up",
  "0100": "ending_right",
  "0010": "ending_down",
  "0001": "ending_left",
  "1100": "corner_up_right",
  "1010": "straight_vertical_window",
  "1001": "corner_up_left",
  "0110": "corner_down_right",
  "0101": "straight_horizontal_window",
  "0011": "corner_down_left",
  "1110": "t_right",
  "1101": "t_up",
  "1011": "t_left",
  "0111": "t_down",
  "1111": "cross",
};

/** Straight pipe windows need an opaque backing below the windowed body. */
const PIPE_WINDOW_BACKGROUND_KEYS: Readonly<Record<string, string>> = {
  "1010": "vertical_window_background",
  "0101": "horizontal_window_background",
};

/** Heat-pipe connection_sprites use different corner names than pipes. */
const HEAT_PIPE_MASK_KEYS: Record<string, string> = {
  "0000": "single",
  "1000": "ending_up",
  "0100": "ending_right",
  "0010": "ending_down",
  "0001": "ending_left",
  "1100": "corner_right_up",
  "1010": "straight_vertical",
  "1001": "corner_left_up",
  "0110": "corner_right_down",
  "0101": "straight_horizontal",
  "0011": "corner_left_down",
  "1110": "t_right",
  "1101": "t_up",
  "1011": "t_left",
  "0111": "t_down",
  "1111": "cross",
};

const CARDINAL_DIRS = [0, 4, 8, 12] as const;
const DIR_DELTA: Record<0 | 4 | 8 | 12, [number, number]> = {
  0: [0, -1],
  4: [1, 0],
  8: [0, 1],
  12: [-1, 0],
};

function rotateOffset(x: number, y: number, dir: 0 | 4 | 8 | 12): [number, number] {
  switch (dir) {
    case 0:
      return [x, y];
    case 4:
      return [-y, x];
    case 8:
      return [-x, -y];
    case 12:
      return [y, -x];
  }
}

interface RawPipeConnection {
  position?: [number, number];
  direction?: number;
  connection_type?: string;
}

/**
 * Compute fluidConnections: entityDir → list of pipe-tile offsets (relative to
 * entity center) where a connecting pipe sits. Derived from prototype
 * pipe_connections by rotating position+direction.
 */
function computeFluidConnections(p: Record<string, unknown>): Record<string, [number, number][]> {
  const boxes: Record<string, unknown>[] = [];
  if (p.fluid_box && typeof p.fluid_box === "object")
    boxes.push(p.fluid_box as Record<string, unknown>);
  if (p.output_fluid_box && typeof p.output_fluid_box === "object") {
    boxes.push(p.output_fluid_box as Record<string, unknown>);
  }
  if (Array.isArray(p.fluid_boxes)) {
    for (const b of p.fluid_boxes) {
      if (b && typeof b === "object") boxes.push(b as Record<string, unknown>);
    }
  }

  const rawConns: RawPipeConnection[] = [];
  for (const b of boxes) {
    const pcs = b.pipe_connections as RawPipeConnection[] | undefined;
    if (!pcs) continue;
    for (const c of pcs) {
      // Skip underground-only links (pipe-to-ground far side).
      if (c.connection_type === "underground") continue;
      if (!c.position || c.direction == null) continue;
      rawConns.push(c);
    }
  }
  if (rawConns.length === 0) return {};

  const out: Record<string, [number, number][]> = {};
  for (const ed of CARDINAL_DIRS) {
    const seen = new Set<string>();
    const list: [number, number][] = [];
    for (const c of rawConns) {
      const [px, py] = c.position as [number, number];
      const [rx, ry] = rotateOffset(px, py, ed);
      const absDir = ((((c.direction as number) + ed) % 16) + 16) % 16;
      const snapped = (Math.round(absDir / 4) * 4) % 16;
      const card = (
        snapped === 0 || snapped === 4 || snapped === 8 || snapped === 12 ? snapped : 0
      ) as 0 | 4 | 8 | 12;
      const [dx, dy] = DIR_DELTA[card];
      const ox = round4(rx + dx);
      const oy = round4(ry + dy);
      const key = `${ox},${oy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push([ox, oy]);
    }
    out[String(ed)] = list;
  }
  return out;
}

/** Heat connection pipe-tile offsets from heat_buffer / energy_source.connections. */
function computeHeatConnections(p: Record<string, unknown>): Record<string, [number, number][]> {
  const hb =
    (p.heat_buffer as { connections?: RawPipeConnection[] } | undefined) ??
    (p.energy_source as { connections?: RawPipeConnection[] } | undefined) ??
    undefined;
  const rawConns = hb?.connections ?? [];
  if (rawConns.length === 0) return {};

  const out: Record<string, [number, number][]> = {};
  for (const ed of CARDINAL_DIRS) {
    const seen = new Set<string>();
    const list: [number, number][] = [];
    for (const c of rawConns) {
      if (!c.position || c.direction == null) continue;
      const [px, py] = c.position;
      const [rx, ry] = rotateOffset(px, py, ed);
      const absDir = (((c.direction + ed) % 16) + 16) % 16;
      const snapped = (Math.round(absDir / 4) * 4) % 16;
      const card = (
        snapped === 0 || snapped === 4 || snapped === 8 || snapped === 12 ? snapped : 0
      ) as 0 | 4 | 8 | 12;
      const [dx, dy] = DIR_DELTA[card];
      const ox = round4(rx + dx);
      const oy = round4(ry + dy);
      const key = `${ox},${oy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push([ox, oy]);
    }
    out[String(ed)] = list;
  }
  return out;
}

function withFluidData(
  def: EntityRenderDef,
  p: Record<string, unknown>,
  extra?: Record<string, unknown>,
): EntityRenderDef {
  const fluidConnections = computeFluidConnections(p);
  const heatConnections = computeHeatConnections(p);
  const data: Record<string, unknown> = { ...def.data, ...extra };
  if (Object.keys(fluidConnections).length > 0) data.fluidConnections = fluidConnections;
  if (Object.keys(heatConnections).length > 0) data.heatConnections = heatConnections;
  if (p.fluid_boxes_off_when_no_fluid_recipe === true) {
    data.fluidBoxesRequireFluidRecipe = true;
  }
  if (Object.keys(data).length === 0) return def;
  return { ...def, data };
}

/** Shared pipe-cover sheet cache (most fluid boxes use identical pipecoverspictures()). */
let pipeCoversCache:
  | {
      key: string;
      covers: SpriteVariant[];
      shadows?: SpriteVariant[];
    }
  | undefined;

function pipeCoversKey(covers: RawSprite): string {
  const dirs = dirs4(covers);
  return dirs
    .map((d) => {
      const leaves = leafLayers(d);
      return leaves.map((l) => `${l.filename ?? ""}:${l.width ?? 0}x${l.height ?? 0}`).join("+");
    })
    .join("|");
}

function firstPipeCoversSprite(p: Record<string, unknown>): RawSprite | undefined {
  const boxes: Record<string, unknown>[] = [];
  if (p.fluid_box && typeof p.fluid_box === "object") {
    boxes.push(p.fluid_box as Record<string, unknown>);
  }
  if (p.output_fluid_box && typeof p.output_fluid_box === "object") {
    boxes.push(p.output_fluid_box as Record<string, unknown>);
  }
  if (Array.isArray(p.fluid_boxes)) {
    for (const b of p.fluid_boxes) {
      if (b && typeof b === "object") boxes.push(b as Record<string, unknown>);
    }
  }
  for (const b of boxes) {
    const pc = b.pipe_covers as RawSprite | undefined;
    if (pc && isSprite4Way(pc)) return pc;
  }
  return undefined;
}

/**
 * Distill fluid-box pipe_covers (Sprite4Way) into data.pipeCovers.
 * Drawn by the planner on unconnected ports (Factorio caps open flanges).
 */
async function withPipeCovers(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  // Pipes / UG pipes already include joints in their own pictures.
  if (def.kind === "pipe" || def.protoType === "pipe-to-ground") return def;
  if (!def.data?.fluidConnections) return def;
  const coversSprite = firstPipeCoversSprite(p);
  if (!coversSprite) return def;

  const key = pipeCoversKey(coversSprite);
  if (!pipeCoversCache || pipeCoversCache.key !== key) {
    const dirs = dirs4(coversSprite);
    const covers: SpriteVariant[] = [];
    const shadows: SpriteVariant[] = [];
    for (let di = 0; di < 4; di++) {
      const leaves = leafLayers(dirs[di] as RawSprite).filter(
        (l) => !l.apply_runtime_tint && !l.draw_as_light,
      );
      let cover: SpriteVariant | undefined;
      let shadow: SpriteVariant | undefined;
      for (const leaf of leaves) {
        const info = await bank.addSprite(leaf, 0, 0);
        const v = bank.toVariant(info);
        if (info.shadow) shadow = v;
        else cover = v;
      }
      if (!cover) return def;
      covers.push(cover);
      if (shadow) shadows.push(shadow);
    }
    pipeCoversCache = {
      key,
      covers,
      shadows: shadows.length === 4 ? shadows : undefined,
    };
  }

  return {
    ...def,
    data: {
      ...def.data,
      pipeCovers: {
        covers: pipeCoversCache.covers,
        shadows: pipeCoversCache.shadows,
      },
    },
  };
}

type WireAnchorPoint = {
  copper?: [number, number];
  red?: [number, number];
  green?: [number, number];
};

function readWirePoint(
  wire: Record<string, unknown> | undefined,
  key: "copper" | "red" | "green",
): [number, number] | undefined {
  const v = wire?.[key];
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const x = v[0];
  const y = v[1];
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  return [round4(x), round4(y)];
}

function anchorsFromWireObj(
  wire: Record<string, unknown> | undefined,
): WireAnchorPoint | undefined {
  if (!wire) return undefined;
  const out: WireAnchorPoint = {};
  const copper = readWirePoint(wire, "copper");
  const red = readWirePoint(wire, "red");
  const green = readWirePoint(wire, "green");
  if (copper) out.copper = copper;
  if (red) out.red = red;
  if (green) out.green = green;
  return Object.keys(out).length > 0 ? out : undefined;
}

function anchorsFromConnectionPoints(
  cps: { wire?: Record<string, unknown> }[] | undefined,
  fallback: WireAnchorPoint,
): Record<string, WireAnchorPoint> {
  const out: Record<string, WireAnchorPoint> = {};
  if (!Array.isArray(cps) || cps.length === 0) return out;
  for (let i = 0; i < cps.length; i++) {
    out[String(i)] = anchorsFromWireObj(cps[i]?.wire) ?? { ...fallback };
  }
  return out;
}

/**
 * Distill wireAnchors from electric-pole connection_points or circuit_connector
 * definitions. Coordinates are already tile-space shifts in the dump.
 * Fallback when nothing is found: center-top [0, -0.5].
 *
 * Combinators / power-switch also emit `wireAnchorsOutput` for connector ids 3/4
 * (and power-switch right copper id 6) — see render-db.ts.
 */
function computeWireAnchors(p: Record<string, unknown>): Record<string, WireAnchorPoint> {
  const out: Record<string, WireAnchorPoint> = {};
  const fallback: WireAnchorPoint = { copper: [0, -0.5], red: [0, -0.5], green: [0, -0.5] };

  const cps = p.connection_points as { wire?: Record<string, unknown> }[] | undefined;
  if (Array.isArray(cps) && cps.length > 0) {
    return anchorsFromConnectionPoints(cps, fallback);
  }

  // Combinator input side (ids 1/2).
  const inputCps = p.input_connection_points as { wire?: Record<string, unknown> }[] | undefined;
  if (Array.isArray(inputCps) && inputCps.length > 0) {
    return anchorsFromConnectionPoints(inputCps, fallback);
  }

  // Constant combinator / power-switch circuit points.
  const circuitPts = p.circuit_wire_connection_points as
    | { wire?: Record<string, unknown> }[]
    | undefined;
  if (Array.isArray(circuitPts) && circuitPts.length > 0) {
    return anchorsFromConnectionPoints(circuitPts, fallback);
  }
  const circuitPt = p.circuit_wire_connection_point as
    | { wire?: Record<string, unknown> }
    | undefined;
  if (circuitPt?.wire) {
    const a = anchorsFromWireObj(circuitPt.wire);
    if (a) {
      out["0"] = a;
      return out;
    }
  }

  // circuit_connector may be top-level or nested under picture sets.
  let connectors = p.circuit_connector as
    | { points?: { wire?: Record<string, unknown> } }[]
    | { points?: { wire?: Record<string, unknown> } }
    | undefined;
  if (!connectors) {
    const gps = p.ground_picture_set as { circuit_connector?: typeof connectors } | undefined;
    connectors = gps?.circuit_connector;
  }
  if (Array.isArray(connectors) && connectors.length > 0) {
    const first = anchorsFromWireObj(connectors[0]?.points?.wire) ?? fallback;
    if (connectors.length === 1) {
      out["0"] = first;
      return out;
    }
    for (let i = 0; i < connectors.length; i++) {
      out[String(i)] = anchorsFromWireObj(connectors[i]?.points?.wire) ?? first;
    }
    return out;
  }
  if (connectors && !Array.isArray(connectors)) {
    out["0"] = anchorsFromWireObj(connectors.points?.wire) ?? fallback;
    return out;
  }

  return out;
}

function computeWireAnchorsOutput(p: Record<string, unknown>): Record<string, WireAnchorPoint> {
  const fallback: WireAnchorPoint = { copper: [0, -0.5], red: [0, -0.5], green: [0, -0.5] };
  const outputCps = p.output_connection_points as { wire?: Record<string, unknown> }[] | undefined;
  if (Array.isArray(outputCps) && outputCps.length > 0) {
    return anchorsFromConnectionPoints(outputCps, fallback);
  }
  // Power-switch right copper (connector id 6) — store under copper.
  const right = p.right_wire_connection_point as { wire?: Record<string, unknown> } | undefined;
  if (right?.wire) {
    const a = anchorsFromWireObj(right.wire);
    if (a) return { "0": a };
  }
  return {};
}

function withWireAnchors(def: EntityRenderDef, p: Record<string, unknown>): EntityRenderDef {
  let wireAnchors = computeWireAnchors(p);
  // Power-switch: merge left copper into input anchors.
  const left = p.left_wire_connection_point as { wire?: Record<string, unknown> } | undefined;
  if (left?.wire) {
    const a = anchorsFromWireObj(left.wire);
    if (a) {
      const base = wireAnchors["0"] ?? {};
      wireAnchors = {
        ...wireAnchors,
        "0": { ...base, ...a, copper: a.copper ?? base.copper },
      };
    }
  }
  const wireAnchorsOutput = computeWireAnchorsOutput(p);
  const data: Record<string, unknown> = { ...def.data };
  if (Object.keys(wireAnchors).length > 0) data.wireAnchors = wireAnchors;
  if (Object.keys(wireAnchorsOutput).length > 0) data.wireAnchorsOutput = wireAnchorsOutput;
  if (!data.wireAnchors && !data.wireAnchorsOutput) return def;
  return { ...def, data };
}

/** CCM sprite keys we distill (FBE draws main + pins + led_blue_off; shadows for depth). */
const CCM_SPRITE_KEYS = [
  "connector_shadow",
  "connector_main",
  "wire_pins_shadow",
  "wire_pins",
  "led_blue_off",
] as const;

type CcmSpriteKey = (typeof CCM_SPRITE_KEYS)[number];

type CircuitConnectorEntry = {
  sprites?: Partial<Record<CcmSpriteKey, RawSprite>>;
  points?: { wire?: Record<string, unknown> };
};

function resolveCircuitConnectorList(
  p: Record<string, unknown>,
): CircuitConnectorEntry[] | undefined {
  const from = (v: unknown): CircuitConnectorEntry[] | undefined => {
    if (Array.isArray(v) && v.length > 0) return v as CircuitConnectorEntry[];
    if (v && typeof v === "object" && !Array.isArray(v)) return [v as CircuitConnectorEntry];
    return undefined;
  };
  return (
    from(p.circuit_connector) ??
    from((p.graphics_set as { circuit_connector?: unknown } | undefined)?.circuit_connector) ??
    from((p.ground_picture_set as { circuit_connector?: unknown } | undefined)?.circuit_connector)
  );
}

/**
 * Distill circuit_connector[].sprites into data.wireConnectorGraphics.
 * Each direction entry already bakes sheet x/y for that facing — sample frame 0.
 */
async function distillCircuitConnectorGraphics(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const list = resolveCircuitConnectorList(p);
  if (!list?.length) return undefined;

  const n = list.length;
  const indexing = n >= 16 ? "direction16" : n >= 4 ? "direction4" : "single";
  const count = indexing === "direction16" ? 16 : indexing === "direction4" ? 4 : 1;
  const layers: Partial<Record<CcmSpriteKey, (SpriteVariant | null)[]>> = {};

  for (const key of CCM_SPRITE_KEYS) {
    const variants: (SpriteVariant | null)[] = [];
    let any = false;
    for (let i = 0; i < count; i++) {
      const entry = list[Math.min(i, list.length - 1)];
      const spr = entry?.sprites?.[key];
      if (!spr) {
        variants.push(null);
        continue;
      }
      const leaves = leafLayers(spr).filter((l) => !l.apply_runtime_tint && !l.draw_as_light);
      if (leaves.length === 0) {
        variants.push(null);
        continue;
      }
      // Prefer non-shadow leaf for non-shadow keys; shadow keys keep shadow leaf.
      const wantShadow = key.endsWith("_shadow");
      const leaf = leaves.find((l) => Boolean(l.draw_as_shadow) === wantShadow) ?? leaves[0];
      if (!leaf) {
        variants.push(null);
        continue;
      }
      const info = await bank.addSprite(leaf, 0, 0);
      variants.push(bank.toVariant(info));
      any = true;
    }
    if (any) layers[key] = variants;
  }

  if (Object.keys(layers).length === 0) return undefined;
  return { indexing, layers };
}

async function withCircuitConnectorGraphics(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const graphics = await distillCircuitConnectorGraphics(bank, p);
  if (!graphics) return def;
  return { ...def, data: { ...def.data, wireConnectorGraphics: graphics } };
}

const BELT_CONNECTOR_FRAME_KEYS = ["frame_shadow", "frame_main", "frame_back_patch"] as const;
const BELT_CONNECTOR_LED_KEYS = ["led_red", "led_green", "led_blue"] as const;

type BeltConnectorFrameSprites = Partial<
  Record<(typeof BELT_CONNECTOR_FRAME_KEYS)[number], { sheet?: RawSprite } | RawSprite>
>;

/**
 * Distill transport-belt connector_frame_sprites + circuit_connector LED sprites.
 * Frame sheets are AnimationVariations (7 topology × 4 behavior-state frames).
 * The state frame is a bitmask: none=0, enable/output=1, read/input=2, both=3.
 * Back patch is SpriteVariations (3). LEDs are per-topology baked sprites.
 *
 * `frame_main` is split into clean cage+pegs plus `wire_horizontal` /
 * `wire_vertical` décor (Factorio masks these in-engine by enable/read).
 */
async function distillBeltConnectorGraphics(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const cfs = p.connector_frame_sprites as BeltConnectorFrameSprites | undefined;
  if (!cfs) return undefined;

  const layers: Record<string, unknown> = {};
  const list = resolveCircuitConnectorList(p);

  for (const key of BELT_CONNECTOR_FRAME_KEYS) {
    const entry = cfs[key];
    if (!entry) continue;
    const sheet = ("sheet" in entry && entry.sheet ? entry.sheet : entry) as RawSprite;
    if (!sheet.filename && !sheet.filenames) continue;
    const variationCount = sheet.variation_count ?? 1;
    const frameCount = sheet.frame_count ?? 1;
    if (frameCount <= 1) {
      // SpriteVariations (back_patch): one variant per variation index.
      const variants: (SpriteVariant | null)[] = [];
      for (let v = 0; v < variationCount; v++) {
        const info = await bank.addSprite(sheet, 0, v);
        variants.push(bank.toVariant(info));
      }
      layers[key] = variants;
      continue;
    }

    // AnimationVariations: [variation][directionFrame].
    const grid: (SpriteVariant | null)[][] = [];
    const wireHGrid: (SpriteVariant | null)[][] = [];
    const wireVGrid: (SpriteVariant | null)[][] = [];
    const splitMain = key === "frame_main";
    const shift = normalizeShift(sheet.shift);
    const scale = sheet.scale ?? 1;

    for (let v = 0; v < variationCount; v++) {
      const row: (SpriteVariant | null)[] = [];
      const hRow: (SpriteVariant | null)[] = [];
      const vRow: (SpriteVariant | null)[] = [];
      const sprites = list?.[v]?.sprites as Record<string, unknown> | undefined;
      const blueOffset = asOffset2(sprites?.blue_led_light_offset, [-0.28, -0.48]);
      const rgOffset = asOffset2(sprites?.red_green_led_light_offset, [0.2, 0.16]);

      for (let f = 0; f < frameCount; f++) {
        if (!splitMain) {
          const info = await bank.addSprite(sheet, f, v);
          row.push(bank.toVariant(info));
          continue;
        }
        const crop = await cropSpriteFrame(sheet, f, v);
        const split = await splitBeltFrameMain(crop, {
          shift,
          scale,
          blueOffset,
          rgOffset,
        });
        const cleanId = await bank.add(split.clean);
        row.push(
          bank.toVariant({
            frameId: cleanId,
            scale,
            shift,
            shadow: false,
          }),
        );
        if (split.wireHorizontal) {
          const id = await bank.add(split.wireHorizontal);
          hRow.push(bank.toVariant({ frameId: id, scale, shift, shadow: false }));
        } else {
          hRow.push(null);
        }
        if (split.wireVertical) {
          const id = await bank.add(split.wireVertical);
          vRow.push(bank.toVariant({ frameId: id, scale, shift, shadow: false }));
        } else {
          vRow.push(null);
        }
      }
      grid.push(row);
      if (splitMain) {
        wireHGrid.push(hRow);
        wireVGrid.push(vRow);
      }
    }
    layers[key] = grid;
    if (splitMain) {
      layers.wire_horizontal = wireHGrid;
      layers.wire_vertical = wireVGrid;
    }
  }

  // LED sprites: each circuit_connector[i] already bakes x/y for topology i.
  if (list?.length) {
    for (const key of BELT_CONNECTOR_LED_KEYS) {
      const variants: (SpriteVariant | null)[] = [];
      let any = false;
      for (let i = 0; i < list.length; i++) {
        const spr = (list[i]?.sprites as Record<string, RawSprite> | undefined)?.[key];
        if (!spr) {
          variants.push(null);
          continue;
        }
        const leaves = leafLayers(spr).filter((l) => !l.apply_runtime_tint && !l.draw_as_light);
        const leaf = leaves[0];
        if (!leaf) {
          variants.push(null);
          continue;
        }
        const info = await bank.addSprite(leaf, 0, 0);
        variants.push(bank.toVariant(info));
        any = true;
      }
      if (any) layers[key] = variants;
    }
  }

  if (Object.keys(layers).length === 0) return undefined;
  return { indexing: "belt-topology", layers };
}

async function withBeltConnectorGraphics(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  if (def.kind !== "belt") return def;
  const graphics = await distillBeltConnectorGraphics(bank, p);
  if (!graphics) return def;
  return { ...def, data: { ...def.data, beltConnectorGraphics: graphics } };
}

type BeltReaderLayerEntry = {
  sprites?: RawSprite;
  render_layer?: string;
};

/**
 * Distill belt_animation_set.belt_reader[] — side-skirt graphics for
 * entire_belt_hold (whole-line read).
 *
 * Engine sheet layout (from Factorio binary validation strings):
 * - rows (direction_count): StraightSolidBand, StraightOpenBand, CurvedSolidBand, Ending
 * - frames: North, East, South, West (tile-edge pieces, not belt facing)
 */
async function distillBeltReaderGraphics(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const bas = p.belt_animation_set as { belt_reader?: BeltReaderLayerEntry[] } | undefined;
  const readers = bas?.belt_reader;
  if (!Array.isArray(readers) || readers.length === 0) return undefined;

  const layers: {
    layer: string;
    /** [band][frame] = StraightSolid/Open/Curved/Ending × N/E/S/W */
    variants: (SpriteVariant | null)[][];
  }[] = [];

  for (const entry of readers) {
    const spr = entry.sprites;
    if (!spr) continue;
    const leaves = leafLayers(spr).filter((l) => !l.apply_runtime_tint && !l.draw_as_light);
    const leaf = leaves[0];
    if (!leaf) continue;
    const bandCount = leaf.direction_count ?? 4;
    const frameCount = leaf.frame_count ?? 4;
    const variants: (SpriteVariant | null)[][] = [];
    for (let band = 0; band < bandCount; band++) {
      const row: (SpriteVariant | null)[] = [];
      for (let frame = 0; frame < frameCount; frame++) {
        const info = await bank.addSprite(leaf, frame, band);
        const meta = bank.metas()[info.frameId];
        if (meta && meta.w <= 1 && meta.h <= 1) {
          row.push(null);
        } else {
          row.push(bank.toVariant(info));
        }
      }
      variants.push(row);
    }
    const layerName =
      officialLayer(entry.render_layer) ??
      guessedLayer("transport-belt-reader", "belt_reader layer missing render_layer");
    if (variants.every((row) => row.every((v) => v == null))) continue;
    layers.push({ layer: layerName, variants });
  }

  if (layers.length === 0) return undefined;
  return { indexing: "belt-reader-band-nesw", layers };
}

async function withBeltReaderGraphics(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  // Belts and undergrounds share belt_animation_set.belt_reader (skirts run under UG hoods).
  if (def.kind !== "belt" && def.kind !== "underground-belt") return def;
  const graphics = await distillBeltReaderGraphics(bank, p);
  if (!graphics) return def;
  return { ...def, data: { ...def.data, beltReaderGraphics: graphics } };
}
/**
 * Wall pictures are asymmetric (Factorio only authors a subset). Map each NESW
 * mask to the closest authored variant; prefer single as fallback.
 */
const WALL_MASK_KEYS: Record<string, string> = {
  "0000": "single",
  "1000": "ending_right", // approximate: stub north-only
  "0100": "ending_right",
  "0010": "ending_left", // approximate
  "0001": "ending_left",
  "1100": "corner_right_down", // approximate
  "1010": "straight_vertical",
  "1001": "corner_left_down", // approximate
  "0110": "corner_right_down",
  "0101": "straight_horizontal",
  "0011": "corner_left_down",
  "1110": "t_up",
  "1101": "t_up",
  "1011": "t_up",
  "0111": "t_up",
  "1111": "t_up",
};

/**
 * Belt animation_set row order (0-based), matching Factorio's commented
 * east_index=1..ending_east_index=20 (1-based) in transport-belts.lua:
 *  0 east, 1 west, 2 north, 3 south,
 *  4 east_to_north, 5 north_to_east, 6 west_to_north, 7 north_to_west,
 *  8 south_to_east, 9 east_to_south, 10 south_to_west, 11 west_to_south,
 *  12 starting_south, 13 ending_south, 14 starting_west, 15 ending_west,
 *  16 starting_north, 17 ending_north, 18 starting_east, 19 ending_east
 */
export const BELT_ROW_ORDER = [
  "east",
  "west",
  "north",
  "south",
  "east_to_north",
  "north_to_east",
  "west_to_north",
  "north_to_west",
  "south_to_east",
  "east_to_south",
  "south_to_west",
  "west_to_south",
  "starting_south",
  "ending_south",
  "starting_west",
  "ending_west",
  "starting_north",
  "ending_north",
  "starting_east",
  "ending_east",
] as const;

/** Per-direction hand pose (FBE spriteDataBuilder.draw_inserter). */
type InserterHandPose = { rot: number; squish: number; x: number; y: number };

/** Regular inserter: [N,E,S,W] for hand_open then hand_base. */
const INSERTER_HAND_POSES: { hand: InserterHandPose; arm: InserterHandPose }[] = [
  // N
  {
    hand: { rot: 0, squish: 3, x: 0, y: -0.5 },
    arm: { rot: 0, squish: 1.4, x: 0, y: 0.05 },
  },
  // E
  {
    hand: { rot: 135, squish: 2.5, x: 0.325, y: -0.325 },
    arm: { rot: 45, squish: 1.9, x: -0.03, y: 0.03 },
  },
  // S
  {
    hand: { rot: 180, squish: 1.75, x: 0, y: 0.03 },
    arm: { rot: 180, squish: 7, x: 0, y: -0.03 },
  },
  // W
  {
    hand: { rot: -135, squish: 2.5, x: -0.325, y: -0.325 },
    arm: { rot: -45, squish: 1.9, x: 0.03, y: 0.03 },
  },
];

/** Long-handed inserter poses (FBE). */
const LHI_HAND_POSES: { hand: InserterHandPose; arm: InserterHandPose }[] = [
  {
    hand: { rot: 180, squish: 3.5, x: 0, y: -0.95 },
    arm: { rot: 0, squish: 1, x: 0, y: 0.05 },
  },
  {
    hand: { rot: 155, squish: 1.5, x: 0.275, y: -0.7 },
    arm: { rot: 25, squish: 1.25, x: -0.03, y: 0.03 },
  },
  {
    hand: { rot: 180, squish: 1.25, x: 0, y: -0.3 },
    arm: { rot: 0, squish: 2.5, x: 0, y: 0.03 },
  },
  {
    hand: { rot: -155, squish: 1.5, x: -0.275, y: -0.7 },
    arm: { rot: -25, squish: 1.25, x: 0.03, y: 0.03 },
  },
];

/**
 * Bottom-center pivot at (pose.x, pose.y): place sprite center by rotating the
 * local (0, -hEff/2) offset with canvas-clockwise degrees.
 */
function inserterHandShift(pose: InserterHandPose, hTiles: number): [number, number] {
  const hEff = hTiles / pose.squish;
  const localDy = -hEff / 2;
  const rad = (pose.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Canvas CW with y-down: (x,y) → (x cos − y sin, x sin + y cos)
  return [round4(pose.x - localDy * sin), round4(pose.y + localDy * cos)];
}

async function distillInserter(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  /**
   * Inserter pose (FBE-compatible):
   * - Layer 0: platform_picture as direction4 (horizontal columns).
   *   Runtime selects the opposite column ((dir+8)%16)/4 — platform art faces drop.
   * - Layers 1–2: hand_base + hand_open with bottom-center pivot, per-dir
   *   rotation/squish/offset so the arm reads as a bent pickup pose.
   * GUESS: dump has no render_layer on inserters; engine hardcodes.
   * Split layers (in-game look): platform under the belt sheet; hands above belts
   * and above assembling-machine bodies so arms aren't buried in the machine.
   */
  const platform = p.platform_picture as RawSprite;
  const platformGroups = await layersFromSprite(bank, platform, {
    layer: guessedLayer("floor", "inserter platform under belts; not in dump"),
    indexing: "direction4",
    assumeDirectionCount: 4,
    sampleDirectionsAsColumns: true,
  });

  const poses =
    (p.name as string | undefined) === "long-handed-inserter"
      ? LHI_HAND_POSES
      : INSERTER_HAND_POSES;

  const handParts: {
    sprite: RawSprite | undefined;
    poseKey: "arm" | "hand";
  }[] = [
    { sprite: p.hand_base_picture as RawSprite | undefined, poseKey: "arm" },
    { sprite: p.hand_open_picture as RawSprite | undefined, poseKey: "hand" },
  ];

  const handGroups: LayerGroup[] = [];
  for (const part of handParts) {
    if (!part.sprite) continue;
    const handInfo = await bank.addSprite(part.sprite, 0, 0);
    const [, shPx] = spriteSize(part.sprite);
    const hTiles = (handInfo.scale * shPx) / 32;
    const handVariants: (SpriteVariant | null)[] = poses.map((dirPose) => {
      const pose = dirPose[part.poseKey];
      return bank.toVariant(handInfo, inserterHandShift(pose, hTiles), {
        rotation: pose.rot,
        scaleY: 1 / pose.squish,
      });
    });
    handGroups.push({
      layer: guessedLayer(
        "higher-object-under",
        "inserter hand above belts and object bodies; not in dump",
      ),
      indexing: "direction4",
      variants: { default: handVariants },
    });
  }

  return baseEntity("inserter", "inserter", p, [...platformGroups, ...handGroups]);
}
/**
 * Skip leaves that Factorio composites additively / as lights. Their source
 * sheets are mostly opaque black with a few bright pixels; drawing them as
 * normal sprites produces solid black rectangles (cargo-hub emissions, etc.).
 */
function skipIdleDecorativeLeaf(leaf: RawSprite): boolean {
  if (leaf.apply_runtime_tint || leaf.draw_as_light || leaf.draw_as_glow) return true;
  if (leaf.blend_mode === "additive" || leaf.blend_mode === "additive-soft") return true;
  return false;
}

async function layersFromSprite(
  bank: FrameBank,
  sprite: RawSprite | undefined,
  opts: {
    layer: RenderLayerName;
    indexing: LayerGroup["indexing"];
    variantKey?: string;
    frame?: number;
    /** Force direction_count when sheet omits it (platform / UG structure). */
    assumeDirectionCount?: number;
    /** Sample 4 directions as horizontal columns (UG structure sheets). */
    sampleDirectionsAsColumns?: boolean;
  },
): Promise<LayerGroup[]> {
  if (!sprite) return [];
  const variantKey = opts.variantKey ?? "default";
  const frame = opts.frame ?? 0;

  // 4-way explicit
  if (isSprite4Way(sprite)) {
    const groups = new Map<string, LayerGroup>();
    const dirs = dirs4(sprite);
    for (let di = 0; di < 4; di++) {
      const leaves = leafLayers(dirs[di]);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (skipIdleDecorativeLeaf(leaf)) continue;
        const info = await bank.addSprite(leaf, frame, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : opts.layer;
        // One LayerGroup per leaf so multi-layer 4-ways (drills, etc.) keep all parts.
        const key = `${layerName}:${info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let g = groups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { [variantKey]: [null, null, null, null] },
          };
          groups.set(key, g);
        }
        const arr = g.variants[variantKey];
        if (!arr) continue;
        arr[di] = bank.toVariant(info);
      }
    }
    return [...groups.values()];
  }

  const leaves = leafLayers(sprite);
  const groups: LayerGroup[] = [];

  for (const leaf of leaves) {
    if (skipIdleDecorativeLeaf(leaf)) continue;
    const assumed = opts.assumeDirectionCount;
    const dirCount = leaf.direction_count ?? assumed ?? 1;
    /**
     * Structure/platform sheets often omit direction_count and pack the 4
     * directions horizontally (as consecutive "frames"). When we assumed the
     * count, sample via frame index on X rather than direction rows on Y.
     */
    const horizontalDirs =
      !opts.sampleDirectionsAsColumns && assumed != null && leaf.direction_count == null;

    const sample = async (d: number) => {
      // Horizontal direction packs: treat dir as frame column (must set
      // frame_count/line_length — bare addSprite(leaf, d, 0) samples rows on Y).
      if (opts.sampleDirectionsAsColumns || horizontalDirs) {
        const n = assumed ?? 4;
        const colLeaf = { ...leaf, line_length: n, frame_count: n, direction_count: 1 };
        return bank.addSprite(colLeaf, d, 0);
      }
      return bank.addSprite(leaf, frame, d);
    };

    const info0 = await sample(0);
    const layerName: RenderLayerName = info0.shadow
      ? fpsrLayer("shadow", "draw_as_shadow leaf")
      : opts.layer;

    if (dirCount <= 1) {
      groups.push({
        layer: layerName,
        indexing: "single",
        variants: { [variantKey]: [bank.toVariant(info0)] },
      });
      continue;
    }

    const variants: (SpriteVariant | null)[] = [];
    for (let d = 0; d < dirCount; d++) {
      const info = d === 0 ? info0 : await sample(d);
      variants.push(bank.toVariant(info));
    }
    const indexing: LayerGroup["indexing"] =
      dirCount === 4
        ? "direction4"
        : dirCount === 8
          ? "direction8"
          : dirCount === 16
            ? "direction16"
            : "resolver";
    groups.push({
      layer: layerName,
      indexing: dirCount === 4 ? "direction4" : indexing,
      variants: { [variantKey]: variants },
    });
  }
  return groups;
}

async function mergeLayerGroups(groups: LayerGroup[]): Promise<LayerGroup[]> {
  // Keep as-is; callers already split shadow/object.
  return groups;
}

function baseEntity(
  kind: EntityKind,
  protoType: string,
  p: Record<string, unknown>,
  graphics: LayerGroup[],
): EntityRenderDef {
  const rawSpec = p.icon_draw_specification as
    | {
        shift?: [number, number];
        scale?: number;
        scale_for_many?: number;
        render_layer?: "entity-info-icon" | "entity-info-icon-above" | "air-entity-info-icon";
      }
    | undefined;
  const collisionBox = boxOf(p, "collision_box");
  const selectionBox = boxOf(p, "selection_box");
  const explicitScale = p.quality_indicator_scale;
  const qualityIndicatorScale =
    typeof explicitScale === "number" && Number.isFinite(explicitScale)
      ? round4(explicitScale)
      : defaultQualityIndicatorScale(collisionBox);
  return {
    kind,
    protoType,
    collisionBox,
    selectionBox,
    graphics,
    qualityIndicatorScale,
    ...(rawSpec
      ? {
          iconDrawSpecification: {
            shift: normalizeShift(rawSpec.shift),
            scale: round4(rawSpec.scale ?? 1),
            scaleForMany: round4(rawSpec.scale_for_many ?? rawSpec.scale ?? 1),
            renderLayer: rawSpec.render_layer ?? "entity-info-icon",
          },
        }
      : {}),
  };
}

/** Factorio default: shorter tile span / 3, clamped to [0.5, 1]. Size 3 → scale 1. */
function defaultQualityIndicatorScale(collisionBox: [[number, number], [number, number]]): number {
  const [[x1, y1], [x2, y2]] = collisionBox;
  const tw = Math.max(1, Math.ceil(Math.abs(x2 - x1) - 1e-6));
  const th = Math.max(1, Math.ceil(Math.abs(y2 - y1) - 1e-6));
  return round4(Math.min(1, Math.max(0.5, Math.min(tw, th) / 3)));
}

async function distillSimplePicture(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind = "simple",
  pictureField = "picture",
): Promise<EntityRenderDef> {
  const pic = p[pictureField] as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, pic, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
  });
  return baseEntity(kind, protoType, p, await mergeLayerGroups(graphics));
}

async function distillGraphicsSetAnimation(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
      }
    | undefined;
  const anim = gs?.animation ?? gs?.idle_animation ?? (p.animation as RawSprite | undefined);
  const graphics = await layersFromSprite(bank, anim, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
    frame: 0,
  });
  return baseEntity(kind, protoType, p, graphics);
}

async function distillDirection4Animation(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
      }
    | undefined;
  const anim =
    gs?.animation ??
    gs?.idle_animation ??
    (p.animations as RawSprite | undefined) ??
    (p.animation as RawSprite | undefined);
  const graphics = await layersFromSprite(bank, anim, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
    frame: 0,
  });
  return baseEntity(kind, protoType, p, graphics);
}

interface WorkingVisualisation {
  always_draw?: boolean;
  apply_tint?: string;
  apply_recipe_tint?: string;
  render_layer?: string;
  draw_in_states?: string[];
  animation?: RawSprite;
  north_animation?: RawSprite;
  east_animation?: RawSprite;
  south_animation?: RawSprite;
  west_animation?: RawSprite;
}

const RUNTIME_WORKING_VIS_TINTS = new Set([
  "resource-color",
  "status",
  "input-fluid-base-color",
  "input-fluid-flow-color",
  "visual-state-color",
]);

const RECIPE_WORKING_VIS_TINTS = new Set(["primary", "secondary", "tertiary", "quaternary"]);

/** Static blueprint view = idle. Skip working-only / tinted runtime overlays. */
function includeWorkingVisualisationForIdle(wv: WorkingVisualisation): boolean {
  if (wv.always_draw !== true) return false;
  if (wv.apply_tint && RUNTIME_WORKING_VIS_TINTS.has(wv.apply_tint)) return false;
  if (wv.apply_recipe_tint && RECIPE_WORKING_VIS_TINTS.has(wv.apply_recipe_tint)) return false;
  if (wv.draw_in_states && wv.draw_in_states.length > 0 && !wv.draw_in_states.includes("idle")) {
    return false;
  }
  return true;
}

/**
 * Mining-drill heads, pumpjack horseheads, EM-plant cores, foundry pipes, etc.
 * live in `graphics_set.working_visualisations` with `always_draw`, not in the
 * base `animation` / `idle_animation` (often just an empty frame).
 */
async function layersFromWorkingVisualisation(
  bank: FrameBank,
  wv: WorkingVisualisation,
): Promise<LayerGroup[]> {
  const layer =
    officialLayer(wv.render_layer) ??
    guessedLayer("object", "working_visualisation; dump has no render_layer");
  const dirSprites = [
    wv.north_animation,
    wv.east_animation,
    wv.south_animation,
    wv.west_animation,
  ] as const;

  if (dirSprites.some((sprite) => sprite != null)) {
    // Mirror layersFromSprite's 4-way path, but keep missing directions as null
    // instead of dirs4's fallback to the parent object.
    const groups = new Map<string, LayerGroup>();
    for (let di = 0; di < 4; di++) {
      const leaves = leafLayers(dirSprites[di]);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (skipIdleDecorativeLeaf(leaf)) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : layer;
        const key = `${layerName}:${info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let g = groups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { default: [null, null, null, null] },
          };
          groups.set(key, g);
        }
        const arr = g.variants.default;
        if (arr) arr[di] = bank.toVariant(info);
      }
    }
    return [...groups.values()];
  }

  if (wv.animation) {
    return layersFromSprite(bank, wv.animation, {
      layer,
      indexing: "single",
      frame: 0,
    });
  }

  return [];
}

async function appendIdleWorkingVisualisations(
  bank: FrameBank,
  groups: LayerGroup[],
  workingVisualisations: WorkingVisualisation[] | undefined,
): Promise<void> {
  for (const wv of workingVisualisations ?? []) {
    if (!includeWorkingVisualisationForIdle(wv)) continue;
    groups.push(...(await layersFromWorkingVisualisation(bank, wv)));
  }
}

/**
 * Floor/platform blend sprites (`integration_patch`). Drawn under the body so
 * thrusters/crushers don't float as nozzle/head-only cutouts.
 */
async function appendIntegrationPatch(
  bank: FrameBank,
  groups: LayerGroup[],
  gs:
    | {
        integration_patch?: RawSprite;
        integration_patch_render_layer?: string;
      }
    | undefined,
): Promise<void> {
  if (!gs?.integration_patch) return;
  const layer =
    officialLayer(gs.integration_patch_render_layer) ??
    guessedLayer("floor", "integration_patch; dump has no render_layer");
  const indexing = isSprite4Way(gs.integration_patch) ? "direction4" : "single";
  groups.push(
    ...(await layersFromSprite(bank, gs.integration_patch, {
      layer,
      indexing,
      frame: 0,
    })),
  );
}

async function distillMiningDrill(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
        working_visualisations?: WorkingVisualisation[];
      }
    | undefined;
  const groups: LayerGroup[] = [];
  const baseAnim =
    gs?.animation ??
    gs?.idle_animation ??
    (p.animations as RawSprite | undefined) ??
    (p.animation as RawSprite | undefined);
  groups.push(
    ...(await layersFromSprite(bank, baseAnim, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "direction4",
      frame: 0,
    })),
  );
  await appendIdleWorkingVisualisations(bank, groups, gs?.working_visualisations);
  return withFluidData(baseEntity("simple", protoType, p, groups), p);
}

async function distillAssembler(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
        working_visualisations?: WorkingVisualisation[];
        integration_patch?: RawSprite;
        integration_patch_render_layer?: string;
      }
    | undefined;
  const anim = gs?.animation ?? gs?.idle_animation ?? (p.animation as RawSprite | undefined);
  const indexing = anim && isSprite4Way(anim) ? "direction4" : "single";
  const groups: LayerGroup[] = [];
  await appendIntegrationPatch(bank, groups, gs);
  groups.push(
    ...(await layersFromSprite(bank, anim, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing,
      frame: 0,
    })),
  );
  await appendIdleWorkingVisualisations(bank, groups, gs?.working_visualisations);
  return withFluidData(baseEntity("assembler", protoType, p, groups), p);
}

/**
 * Thruster body is only the nozzle stack; `integration_patch` is the platform
 * mount, and always_draw WVs are the pipe stubs at the platform edge.
 */
async function distillThruster(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        integration_patch?: RawSprite;
        integration_patch_render_layer?: string;
        working_visualisations?: WorkingVisualisation[];
      }
    | undefined;
  const groups: LayerGroup[] = [];
  await appendIntegrationPatch(bank, groups, gs);
  groups.push(
    ...(await layersFromSprite(bank, gs?.animation, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      frame: 0,
    })),
  );
  await appendIdleWorkingVisualisations(bank, groups, gs?.working_visualisations);
  return withFluidData(baseEntity("simple", "thruster", p, groups), p);
}

/**
 * Asteroid-collector top animation is only the head shell (transparent hopper
 * opening). `below_*` hang under the platform edge; `arm_head*` is the idle
 * grabber that sits in that opening. Full arm-link FK is deferred.
 */
async function distillAsteroidCollector(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        below_ground_pictures?: RawSprite;
        below_arm_pictures?: RawSprite;
        arm_head_animation?: RawSprite;
        arm_head_top_animation?: RawSprite;
      }
    | undefined;
  const groups: LayerGroup[] = [];
  groups.push(
    ...(await layersFromSprite(bank, gs?.below_ground_pictures, {
      layer: guessedLayer("lower-object", "asteroid-collector below_ground under platform edge"),
      indexing: "single",
      frame: 0,
    })),
  );
  // Must paint above the entity shadow: the head shell has a transparent hopper
  // opening, and a shadow-under-hole reads as a solid black void.
  groups.push(
    ...(await layersFromSprite(bank, gs?.below_arm_pictures, {
      layer: guessedLayer("object", "asteroid-collector below_arm visible through hopper opening"),
      indexing: "single",
      frame: 0,
    })),
  );
  const animIndexing = gs?.animation && isSprite4Way(gs.animation) ? "direction4" : "single";
  groups.push(
    ...(await layersFromSprite(bank, gs?.animation, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: animIndexing,
      frame: 0,
    })),
  );

  // 32-way head sheets: map N/E/S/W → directions 0/8/16/24, idle frame 0.
  for (const arm of [gs?.arm_head_animation, gs?.arm_head_top_animation]) {
    if (!arm) continue;
    const dirCount = arm.direction_count ?? 1;
    if (dirCount < 4) {
      groups.push(
        ...(await layersFromSprite(bank, arm, {
          layer: guessedLayer("object", "asteroid-collector idle arm head"),
          indexing: "single",
          frame: 0,
        })),
      );
      continue;
    }
    const step = Math.max(1, Math.round(dirCount / 4));
    const variants: (SpriteVariant | null)[] = [];
    for (let di = 0; di < 4; di++) {
      const info = await bank.addSprite(arm, 0, (di * step) % dirCount);
      variants.push(bank.toVariant(info));
    }
    groups.push({
      layer: guessedLayer("object", "asteroid-collector idle arm head"),
      indexing: "direction4",
      variants: { default: variants },
    });
  }

  return baseEntity("simple", "asteroid-collector", p, groups);
}

interface CranePartRaw {
  name?: string;
  rotated_sprite?: RawSprite;
  rotated_sprite_shadow?: RawSprite;
}

/** Crane Vector3D is (x, y, z-up). Body lifts Z into screen -Y. */
const CRANE_HEIGHT_TO_Y = 0.5;

function cranePartScreenPos(
  origin: readonly number[] | undefined,
  shadowDirection: readonly number[] | undefined,
  kind: "body" | "shadow",
): [number, number] {
  const ox = origin?.[0] ?? 0;
  const oy = origin?.[1] ?? 0;
  const oz = origin?.[2] ?? 0;
  if (kind === "body") {
    return [ox, oy - oz * CRANE_HEIGHT_TO_Y];
  }
  // shadow_direction points toward the light (positive z). Cast the elevated
  // point onto the ground plane z=0 opposite the light so the shadow sits under
  // the crane rather than floating at hub height.
  const sx = shadowDirection?.[0] ?? 0;
  const sy = shadowDirection?.[1] ?? 0;
  const sz = shadowDirection?.[2] ?? 0;
  if (oz > 0 && sz > 1e-6) {
    const t = oz / sz;
    return [ox - sx * t, oy - sy * t];
  }
  return [ox, oy];
}

/**
 * Agricultural-tower `graphics_set.animation` is only the base silo. The crane
 * hub lives under `crane.parts` as rotated sprites. Blueprint idle draws the
 * hub at `crane.origin` (Z→screen Y) above the silo, and casts its shadow onto
 * the ground via `shadow_direction`. Full articulated arm FK is deferred.
 */
async function distillAgriculturalTower(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        animation?: RawSprite;
        idle_animation?: RawSprite;
        working_visualisations?: WorkingVisualisation[];
      }
    | undefined;
  const groups: LayerGroup[] = [];
  const baseAnim = gs?.animation ?? gs?.idle_animation;
  groups.push(
    ...(await layersFromSprite(bank, baseAnim, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      frame: 0,
    })),
  );
  await appendIdleWorkingVisualisations(bank, groups, gs?.working_visualisations);

  const crane = p.crane as
    | {
        origin?: number[];
        shadow_direction?: number[];
        parts?: CranePartRaw[];
      }
    | undefined;
  const hub = crane?.parts?.find((part) => part.name === "hub") ?? crane?.parts?.[0] ?? undefined;
  const bodyPos = cranePartScreenPos(crane?.origin, crane?.shadow_direction, "body");
  const shadowPos = cranePartScreenPos(crane?.origin, crane?.shadow_direction, "shadow");

  for (const [sprite, pos] of [
    [hub?.rotated_sprite, bodyPos],
    [hub?.rotated_sprite_shadow, shadowPos],
  ] as const) {
    if (!sprite) continue;
    for (const leaf of leafLayers(sprite)) {
      if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
      const info = await bank.addSprite(leaf, 0, 0);
      // Same-layer Y-sort buries the hub under the silo body.
      const layerName: RenderLayerName = info.shadow
        ? fpsrLayer("shadow", "draw_as_shadow leaf")
        : guessedLayer("higher-object-under", "agricultural-tower crane hub above silo body");
      groups.push({
        layer: layerName,
        indexing: "single",
        variants: {
          default: [
            bank.toVariant(info, [round4(info.shift[0] + pos[0]), round4(info.shift[1] + pos[1])]),
          ],
        },
      });
    }
  }

  return baseEntity("simple", protoType, p, groups);
}

async function distillPipe(bank: FrameBank, p: Record<string, unknown>): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, RawSprite>;
  const backgroundVariants: Record<string, (SpriteVariant | null)[]> = {};
  const objectVariants: Record<string, (SpriteVariant | null)[]> = {};

  for (const [mask, key] of Object.entries(PIPE_MASK_KEYS)) {
    const backgroundKey = PIPE_WINDOW_BACKGROUND_KEYS[mask];
    const background = backgroundKey ? pictures[backgroundKey] : undefined;
    if (backgroundKey && !background) throw new Error(`pipe missing picture ${backgroundKey}`);
    const backgroundLeaf = background
      ? leafLayers(background).find((leaf) => !leaf.draw_as_shadow)
      : undefined;
    backgroundVariants[mask] = backgroundLeaf
      ? [bank.toVariant(await bank.addSprite(backgroundLeaf, 0, 0))]
      : [null];

    const spr = pictures[key];
    if (!spr) throw new Error(`pipe missing picture ${key}`);
    const leaves = leafLayers(spr);
    const variants: SpriteVariant[] = [];
    for (const leaf of leaves) {
      if (leaf.draw_as_shadow) continue;
      const info = await bank.addSprite(leaf, 0, 0);
      variants.push(bank.toVariant(info));
    }
    const first = variants[0];
    objectVariants[mask] = first ? [first] : [null];
  }

  return withFluidData(
    baseEntity("pipe", "pipe", p, [
      {
        layer: guessedLayer("object-under", "pipe window background below pipe body"),
        indexing: "single",
        variants: backgroundVariants,
      },
      {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        variants: objectVariants,
      },
    ]),
    p,
  );
}

async function distillHeatPipe(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.connection_sprites as Record<string, RawSprite | RawSprite[]>;
  const objectVariants: Record<string, (SpriteVariant | null)[]> = {};

  for (const [mask, key] of Object.entries(HEAT_PIPE_MASK_KEYS)) {
    const raw = pictures[key];
    const spr = Array.isArray(raw) ? raw[0] : raw;
    if (!spr) {
      objectVariants[mask] = [null];
      continue;
    }
    const leaves = leafLayers(spr).filter((l) => !l.draw_as_shadow);
    const leaf = leaves[0];
    if (!leaf) {
      objectVariants[mask] = [null];
      continue;
    }
    const info = await bank.addSprite(leaf, 0, 0);
    objectVariants[mask] = [bank.toVariant(info)];
  }

  return withFluidData(
    baseEntity("heat-pipe", "heat-pipe", p, [
      {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        variants: objectVariants,
      },
    ]),
    p,
  );
}

async function distillWall(bank: FrameBank, p: Record<string, unknown>): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, RawSprite>;
  const objectVariants: Record<string, (SpriteVariant | null)[]> = {};

  for (const [mask, key] of Object.entries(WALL_MASK_KEYS)) {
    const spr = pictures[key] ?? pictures.single;
    const leaves = leafLayers(spr).filter((l) => !l.draw_as_shadow);
    const leaf = leaves[0];
    if (!leaf) {
      objectVariants[mask] = [null];
      continue;
    }
    const info = await bank.addSprite(leaf, 0, 0);
    objectVariants[mask] = [bank.toVariant(info)];
  }

  return baseEntity("wall", "wall", p, [
    {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      variants: objectVariants,
    },
  ]);
}

async function distillGate(bank: FrameBank, p: Record<string, unknown>): Promise<EntityRenderDef> {
  const vertical = p.vertical_animation as RawSprite;
  const horizontal = p.horizontal_animation as RawSprite;
  const groups: LayerGroup[] = [];

  for (const [key, spr] of [
    ["vertical", vertical],
    ["horizontal", horizontal],
  ] as const) {
    const parts = await layersFromSprite(bank, spr, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
      variantKey: key,
      frame: 0,
    });
    for (const part of parts) {
      const existing = groups.find((g) => g.layer === part.layer && g.indexing === part.indexing);
      if (existing) Object.assign(existing.variants, part.variants);
      else groups.push(part);
    }
  }

  return baseEntity("gate", "gate", p, groups);
}

async function distillBoiler(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, { structure?: RawSprite }> | undefined;
  if (pictures?.north?.structure) {
    // Explicit 4-way structure under pictures.north/east/south/west
    const groups = new Map<string, LayerGroup>();
    const dirs = ["north", "east", "south", "west"] as const;
    for (let di = 0; di < 4; di++) {
      const dirName = dirs[di];
      if (dirName === undefined) continue;
      const struct = pictures[dirName]?.structure;
      if (!struct) continue;
      const leaves = leafLayers(struct);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump");
        const key = `${layerName}:${info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let g = groups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { default: [null, null, null, null] },
          };
          groups.set(key, g);
        }
        const arr = g.variants.default;
        if (arr) arr[di] = bank.toVariant(info);
      }
    }
    return withFluidData(baseEntity("simple", protoType, p, [...groups.values()]), p);
  }
  return withFluidData(await distillDirection4Animation(bank, p, protoType, "simple"), p);
}

async function distillStorageTank(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as { picture?: RawSprite } | undefined;
  const pic = pictures?.picture;
  // Storage tank uses a SpriteNWaySheet with `frames: 2` (N/S vs E/W) — treat
  // as direction4 by sampling sheet cells 0 and 1 (see spriteFrameCount).
  if (pic) {
    const leaves = leafLayers(pic);
    const groups: LayerGroup[] = [];
    for (const leaf of leaves) {
      if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
      // Ensure `frames` is visible as frame_count for cropSpriteFrame.
      const sheet: RawSprite = {
        ...leaf,
        frame_count: leaf.frame_count ?? (typeof leaf.frames === "number" ? leaf.frames : 2),
      };
      const info0 = await bank.addSprite(sheet, 0, 0);
      const info1 = await bank.addSprite(sheet, 1, 0);
      const v0 = bank.toVariant(info0);
      const v1 = bank.toVariant(info1);
      // direction4: N=0, E=1, S=2, W=3 → frames 0,1,0,1
      groups.push({
        layer: info0.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump"),
        indexing: "direction4",
        variants: { default: [v0, v1, v0, v1] },
      });
    }
    return withFluidData(baseEntity("simple", "storage-tank", p, groups), p);
  }
  return withFluidData(await distillSimplePicture(bank, p, "storage-tank"), p);
}

async function distillPump(bank: FrameBank, p: Record<string, unknown>): Promise<EntityRenderDef> {
  const anims = p.animations as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, anims, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
    frame: 0,
  });
  return withFluidData(baseEntity("simple", "pump", p, graphics), p);
}

async function distillOffshorePump(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as { animation?: RawSprite; base_pictures?: RawSprite } | undefined;
  const groups: LayerGroup[] = [];
  if (gs?.base_pictures) {
    groups.push(
      ...(await layersFromSprite(bank, gs.base_pictures, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "direction4",
        frame: 0,
      })),
    );
  }
  if (gs?.animation) {
    groups.push(
      ...(await layersFromSprite(bank, gs.animation, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "direction4",
        frame: 0,
      })),
    );
  }
  if (groups.length === 0) {
    return withFluidData(await distillDirection4Animation(bank, p, "offshore-pump", "simple"), p);
  }
  return withFluidData(baseEntity("simple", "offshore-pump", p, groups), p);
}

async function distillSteamEngine(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, { animation?: RawSprite }> | undefined;
  // steam-engine/turbine only author north + east; south/west mirror.
  if (pictures?.north?.animation || pictures?.east?.animation) {
    const groups = new Map<string, LayerGroup>();
    const sample = async (dirName: "north" | "east", di: number) => {
      const anim = pictures[dirName]?.animation;
      if (!anim) return;
      const leaves = leafLayers(anim);
      let leafIdx = 0;
      for (const leaf of leaves) {
        if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump");
        const key = `${layerName}:${info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let g = groups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { default: [null, null, null, null] },
          };
          groups.set(key, g);
        }
        const arr = g.variants.default;
        if (arr) arr[di] = bank.toVariant(info);
      }
    };
    await sample("north", 0);
    await sample("east", 1);
    // Copy N→S, E→W as approximation (game mirrors).
    for (const g of groups.values()) {
      const arr = g.variants.default;
      if (!arr) continue;
      arr[2] = arr[0] ?? null;
      arr[3] = arr[1] ?? null;
    }
    return withFluidData(baseEntity("simple", protoType, p, [...groups.values()]), p);
  }
  return withFluidData(await distillDirection4Animation(bank, p, protoType, "simple"), p);
}

async function distillReactor(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pic = p.picture as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, pic, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
  });
  return withFluidData(baseEntity("simple", "reactor", p, graphics), p);
}

async function distillBelt(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const bas = p.belt_animation_set as { animation_set: RawSprite };
  const sheet = bas.animation_set;
  const dirCount = sheet.direction_count ?? 20;
  const variants: (SpriteVariant | null)[] = [];
  for (let d = 0; d < dirCount; d++) {
    const info = await bank.addSprite(sheet, 0, d);
    variants.push(bank.toVariant(info));
  }
  return baseEntity("belt", protoType, p, [
    {
      // GUESS: main belt sheet has no render_layer; belt_reader[] is distilled separately.
      layer: guessedLayer("transport-belt", "belt animation_set body; not in dump"),
      indexing: "resolver",
      variants: { default: variants },
    },
  ]);
}

/**
 * Belt underlay for UG/loader/splitter: direction4 straights plus start/end cap
 * rows (N,E,S,W). Sheet rows: east=0, west=1, north=2, south=3; starts 12/14/16/18;
 * ends 17/19/13/15 (same mapping as BELT_START_INDEX / BELT_END_INDEX).
 */
async function distillBeltUnderlayGroup(bank: FrameBank, sheet: RawSprite): Promise<LayerGroup> {
  const straightRows = [2, 0, 3, 1];
  const startRows = [12, 14, 16, 18];
  const endRows = [17, 19, 13, 15];
  const sample = async (rows: number[]): Promise<(SpriteVariant | null)[]> => {
    const out: (SpriteVariant | null)[] = [];
    for (const row of rows) {
      const info = await bank.addSprite(sheet, 0, row);
      out.push(bank.toVariant(info));
    }
    return out;
  };
  return {
    // GUESS: underlay uses same band as belt body; dump only labels belt_reader overlays.
    layer: guessedLayer("transport-belt", "belt underlay sheet; not in dump"),
    indexing: "direction4",
    variants: {
      default: await sample(straightRows),
      start: await sample(startRows),
      end: await sample(endRows),
    },
  };
}

async function distillUndergroundBelt(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const structure = p.structure as {
    direction_in: RawSprite;
    direction_out: RawSprite;
    back_patch?: RawSprite;
    front_patch?: RawSprite;
  };
  const groups: LayerGroup[] = [];

  // OFFICIAL when loader sets structure_render_layer; else GUESS object (UG has none).
  const structureLayer =
    officialLayer(p.structure_render_layer) ??
    guessedLayer("object", "UG/loader hood; dump has no structure_render_layer");

  // Back patch sits between belt and hood (FBE paint order).
  if (structure.back_patch) {
    const back = await layersFromSprite(bank, structure.back_patch, {
      layer: guessedLayer("object-under", "UG back_patch; FBE order, not in dump"),
      indexing: "direction4",
      assumeDirectionCount: 4,
      sampleDirectionsAsColumns: true,
    });
    groups.push(...back);
  }

  for (const [key, spr] of [
    ["in", structure.direction_in],
    ["out", structure.direction_out],
  ] as const) {
    const g = await layersFromSprite(bank, spr, {
      layer: structureLayer,
      indexing: "direction4",
      variantKey: key,
      assumeDirectionCount: 4,
      sampleDirectionsAsColumns: true,
    });
    // Merge into one group per layer with both variant keys
    for (const part of g) {
      const existing = groups.find((x) => x.layer === part.layer && x.indexing === part.indexing);
      if (existing) {
        Object.assign(existing.variants, part.variants);
      } else {
        groups.push(part);
      }
    }
  }

  // Front patch completes the hood lip; own group so it paints after the main structure.
  if (structure.front_patch) {
    const front = await layersFromSprite(bank, structure.front_patch, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "direction4",
      assumeDirectionCount: 4,
      sampleDirectionsAsColumns: true,
    });
    groups.push(...front);
  }

  // Also include belt animation underneath (straights + start/end caps).
  const bas = p.belt_animation_set as { animation_set: RawSprite } | undefined;
  if (bas?.animation_set) {
    const underlay = await distillBeltUnderlayGroup(bank, bas.animation_set);
    groups.unshift(underlay);
  }

  return baseEntity("underground-belt", protoType, p, groups);
}

async function distillSplitter(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const structure = p.structure as RawSprite;
  const structureGraphics = await layersFromSprite(bank, structure, {
    layer: guessedLayer("object", "splitter structure; not in dump"),
    indexing: "direction4",
    frame: 0,
  });
  const graphics: LayerGroup[] = [];

  const patch = p.structure_patch as RawSprite | undefined;
  if (patch && isSprite4Way(patch)) {
    const patchGroup: LayerGroup = {
      layer: guessedLayer("object-under", "splitter structure_patch; FBE order, not in dump"),
      indexing: "direction4",
      variants: { default: [null, null, null, null] },
    };
    const dirs = dirs4(patch);
    for (let di = 0; di < 4; di++) {
      const leaf = dirs[di];
      if (!leaf || leaf.filename?.includes("empty.png")) continue;
      const info = await bank.addSprite(leaf, 0, 0);
      patchGroup.variants.default![di] = bank.toVariant(info);
    }
    graphics.push(patchGroup);
  }
  graphics.push(...structureGraphics);

  // Belt underlay (straights + start/end caps for continuous lane ends)
  const bas = p.belt_animation_set as { animation_set: RawSprite } | undefined;
  if (bas?.animation_set) {
    graphics.unshift(await distillBeltUnderlayGroup(bank, bas.animation_set));
  }
  return {
    ...baseEntity("splitter", protoType, p, graphics),
    data: { tileSize: [2, 1] },
  };
}

async function distillBeacon(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as {
    animation_list?: {
      animation: RawSprite;
      render_layer?: string;
      always_draw?: boolean;
    }[];
    module_visualisations?: {
      art_style?: string;
      use_for_empty_slots?: boolean;
      slots?: {
        has_empty_slot?: boolean;
        render_layer?: string;
        pictures?: RawSprite;
        apply_module_tint?: string;
      }[][];
    }[];
  };
  const groups: LayerGroup[] = [];
  for (const entry of gs.animation_list ?? []) {
    // The static blueprint renderer represents an idle/unpowered beacon. Optional
    // module-tinted and light animations use additive blending in Factorio; drawing
    // their opaque-black source sheets normally produces a large black rectangle.
    if (entry.always_draw === false) continue;
    // OFFICIAL: graphics_set.animation_list[].render_layer from dump.
    const layer =
      officialLayer(entry.render_layer) ??
      guessedLayer("object", "beacon animation_list entry missing render_layer");
    const parts = await layersFromSprite(bank, entry.animation, {
      layer,
      indexing: "single",
      frame: 0,
    });
    groups.push(...parts);
  }

  // beacon-bottom has painted module-slot recesses that read as black holes without
  // the empty-slot chrome Factorio draws via module_visualisations. Blueprint view
  // uses that non-module (empty-slot) cover — not the tinted/filled module layers.
  for (const style of gs.module_visualisations ?? []) {
    if (!style.use_for_empty_slots) continue;
    for (const slotLayers of style.slots ?? []) {
      for (const vis of slotLayers) {
        if (!vis.has_empty_slot || !vis.pictures) continue;
        if (vis.pictures.draw_as_light || vis.apply_module_tint) continue;
        const layer =
          officialLayer(vis.render_layer) ??
          guessedLayer("lower-object", "beacon empty module slot missing render_layer");
        // Variation 0 is the empty-slot cover (has_empty_slot sheet).
        const info = await bank.addSprite(vis.pictures, 0, 0);
        groups.push({
          layer,
          indexing: "single",
          variants: { default: [bank.toVariant(info)] },
        });
      }
    }
  }

  return baseEntity("simple", "beacon", p, groups);
}

async function distillLab(bank: FrameBank, p: Record<string, unknown>): Promise<EntityRenderDef> {
  const off = p.off_animation as RawSprite;
  const graphics = await layersFromSprite(bank, off, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
    frame: 0,
  });
  return baseEntity("simple", "lab", p, graphics);
}

async function distillAccumulator(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const cg = p.chargable_graphics as { picture?: RawSprite };
  const graphics = await layersFromSprite(bank, cg.picture, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
  });
  return baseEntity("simple", "accumulator", p, graphics);
}

async function distillRadar(bank: FrameBank, p: Record<string, unknown>): Promise<EntityRenderDef> {
  // Use direction index 0 only (single pose) for M1 — radar has 64 directions.
  const pictures = p.pictures as RawSprite;
  const forced: LayerGroup[] = [];
  for (const leaf of leafLayers(pictures)) {
    if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
    const info = await bank.addSprite(leaf, 0, 0);
    forced.push({
      layer: info.shadow
        ? fpsrLayer("shadow", "draw_as_shadow leaf")
        : guessedLayer("object", "entity body; not in dump"),
      indexing: "single",
      variants: { default: [bank.toVariant(info)] },
    });
  }
  return baseEntity("simple", "radar", p, forced);
}

async function distillElectricPole(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as RawSprite;
  const graphics = await layersFromSprite(bank, pictures, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
  });
  return withWireAnchors(baseEntity("simple", "electric-pole", p, graphics), p);
}

const RAIL_DIR8_KEYS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

/**
 * Resolve rail piece layer from dump `pictures.render_layers` (OFFICIAL).
 * Sheet piece names (ties/backplates/…) map to dump keys (tie/screw/…).
 * TODO(M3): rail endings, segment visualisations, variation_count>0.
 */
function railPieceLayer(
  pictures: Record<string, unknown> | undefined,
  piece: string,
  elevated: boolean,
): RenderLayerName {
  return railPieceLayerFromDump(pictures, piece, elevated).layer;
}

async function addRailPieceVariant(
  bank: FrameBank,
  spr: RawSprite | undefined,
): Promise<SpriteVariant | null> {
  if (!spr) return null;
  // Prefer first non-shadow leaf (stone_path_background may be layered).
  const leaves = leafLayers(spr).filter(
    (l) => !l.draw_as_shadow && !l.apply_runtime_tint && !l.draw_as_light,
  );
  const leaf = leaves[0];
  if (!leaf) return null;
  // Skip empty / unused direction stubs (1×1 placeholders).
  try {
    const [w, h] = spriteSize(leaf);
    if (w <= 1 && h <= 1) return null;
  } catch {
    return null;
  }
  const info = await bank.addSprite(leaf, 0, 0);
  return bank.toVariant(info);
}

async function distillRail(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  elevated: boolean,
): Promise<EntityRenderDef> {
  const pictures = p.pictures as Record<string, Record<string, RawSprite>> | undefined;
  if (!pictures) return baseEntity("rail", protoType, p, []);

  // Pieces we emit, in draw order (background → metal).
  // TODO(M3): also emit rail_endings when neighbor logic exists.
  const pieces = elevated
    ? (["stone_path_background", "stone_path", "backplates", "metals"] as const)
    : (["stone_path_background", "stone_path", "ties", "backplates", "metals"] as const);

  const groups: LayerGroup[] = [];

  for (const piece of pieces) {
    const layer = railPieceLayer(pictures as Record<string, unknown>, piece, elevated);
    if (!layer) continue;
    const variants: (SpriteVariant | null)[] = [];
    for (let i = 0; i < 8; i++) {
      const key = RAIL_DIR8_KEYS[i];
      const dirPics = key ? pictures[key] : undefined;
      const spr = dirPics?.[piece];
      variants.push(await addRailPieceVariant(bank, spr));
    }
    // Fold missing opposite dirs (straight / half-diagonal only author 0..3).
    for (let i = 0; i < 4; i++) {
      if (!variants[i + 4] && variants[i]) variants[i + 4] = variants[i] ?? null;
    }
    if (variants.every((v) => v == null)) continue;
    groups.push({
      layer,
      indexing: "direction8",
      variants: { default: variants },
    });
  }

  return baseEntity("rail", protoType, p, groups);
}

async function distillRailRamp(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  // Ramp: 4 cardinal picture keys; layers from dump render_layers when present.
  // TODO(M3): fence_pictures, fog_mask, dual secondary_render_layers.
  const pictures = p.pictures as Record<string, Record<string, RawSprite>> | undefined;
  const cardKeys = ["north", "east", "south", "west"] as const;
  const pieces = ["stone_path_background", "stone_path", "ties"] as const;
  const groups: LayerGroup[] = [];
  for (const piece of pieces) {
    const layer = railPieceLayer(pictures as Record<string, unknown> | undefined, piece, true);
    const variants: (SpriteVariant | null)[] = [];
    for (const key of cardKeys) {
      variants.push(await addRailPieceVariant(bank, pictures?.[key]?.[piece]));
    }
    if (variants.every((v) => v == null)) continue;
    groups.push({ layer, indexing: "direction4", variants: { default: variants } });
  }
  return baseEntity("rail", "rail-ramp", p, groups);
}

async function distillRailSupport(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as { structure?: RawSprite } | undefined;
  const graphics = await layersFromSprite(bank, gs?.structure, {
    layer: guessedLayer("elevated-object", "rail-support structure; not in dump"),
    indexing: "direction8",
  });
  return baseEntity("simple", "rail-support", p, graphics);
}

async function distillRailSignal(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  // TODO(M3): elevated_picture_set + elevation offset when signal sits on elevated rail.
  const gps = p.ground_picture_set as {
    structure?: RawSprite;
    structure_render_layer?: string;
    circuit_connector?: unknown;
  };
  // OFFICIAL: ground_picture_set.structure_render_layer (e.g. floor-mechanics).
  const structureLayer =
    officialLayer(gps?.structure_render_layer) ??
    guessedLayer("object", "rail signal structure; dump missing structure_render_layer");
  const graphics = await layersFromSprite(bank, gps?.structure, {
    layer: structureLayer,
    indexing: "direction16",
    frame: 0, // idle / green frame of the 3-frame light sheet
  });
  // Attach circuit anchors from the picture set.
  const withCc = {
    ...p,
    circuit_connector: gps?.circuit_connector ?? p.circuit_connector,
  };
  return withWireAnchors(baseEntity("rail-signal", protoType, p, graphics), withCc);
}

/** Max distilled train poses (atlas budget). */
const TRAIN_MAX_POSES = 64;

function trainPoseDirs(dirCount: number): number[] {
  const step = Math.max(1, Math.ceil(dirCount / TRAIN_MAX_POSES));
  const poses: number[] = [];
  for (let d = 0; d < dirCount; d += step) poses.push(d);
  return poses;
}

function colorFromProto(p: Record<string, unknown>): [number, number, number, number] | undefined {
  const c = p.color as { r?: number; g?: number; b?: number; a?: number } | number[] | undefined;
  if (Array.isArray(c) && c.length >= 3) {
    return [
      round4(Number(c[0]) || 0),
      round4(Number(c[1]) || 0),
      round4(Number(c[2]) || 0),
      round4(c[3] == null ? 1 : Number(c[3]) || 0),
    ];
  }
  if (!c || typeof c !== "object") return undefined;
  const rgba = c as { r?: number; g?: number; b?: number; a?: number };
  return [round4(rgba.r ?? 1), round4(rgba.g ?? 1), round4(rgba.b ?? 1), round4(rgba.a ?? 1)];
}

async function distillTrainRotatedLeaf(
  bank: FrameBank,
  leaf: RawSprite,
  layerName: RenderLayerName,
): Promise<{ group: LayerGroup; poseCount: number }> {
  const dirCount = leaf.direction_count ?? 1;
  const poses = trainPoseDirs(dirCount);
  const info0 = await bank.addSprite(leaf, 0, poses[0] ?? 0);
  const variants: (SpriteVariant | null)[] = [];
  for (let i = 0; i < poses.length; i++) {
    const d = poses[i] ?? 0;
    const info = i === 0 ? info0 : await bank.addSprite(leaf, 0, d);
    variants.push(bank.toVariant(info));
  }
  return {
    poseCount: poses.length,
    group: {
      layer: layerName,
      indexing: "resolver",
      variants: { default: variants },
    },
  };
}

async function distillVehicleRotatedLeaf(
  bank: FrameBank,
  leaf: RawSprite,
  layerName: RenderLayerName,
  frame: number,
): Promise<{ group: LayerGroup; poseCount: number }> {
  const poseCount = Math.max(1, leaf.direction_count ?? 1);
  const variants: (SpriteVariant | null)[] = [];
  for (let direction = 0; direction < poseCount; direction++) {
    const info = await bank.addSprite(leaf, frame, direction);
    variants.push(bank.toVariant(info));
  }
  return {
    poseCount,
    group: {
      layer: layerName,
      indexing: "resolver",
      variants: { default: variants },
    },
  };
}

/**
 * Cars and tanks author their body, tint masks, shadows, and turret as direct
 * 64-way RotatedAnimation poses. Unlike trains these poses use blueprint
 * orientation through the renderer's vehicle-sheet projection, without
 * Factorio's rolling-stock-only rail and bogie offsets.
 */
async function distillVehicle(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  const colorMaskGroupIndices: number[] = [];
  let orientationCount: number | undefined;

  for (const sprite of [
    p.animation as RawSprite | undefined,
    p.turret_animation as RawSprite | undefined,
  ]) {
    for (const leaf of leafLayers(sprite).filter((candidate) => !candidate.draw_as_light)) {
      const layerName: RenderLayerName = leaf.draw_as_shadow
        ? fpsrLayer("shadow", "vehicle draw_as_shadow leaf")
        : guessedLayer("object", "vehicle body, mask, or turret");
      const frame = Math.min(leaf.still_frame ?? 0, Math.max(0, (leaf.frame_count ?? 1) - 1));
      const { group, poseCount } = await distillVehicleRotatedLeaf(bank, leaf, layerName, frame);
      orientationCount = Math.min(orientationCount ?? poseCount, poseCount);
      if (leaf.apply_runtime_tint === true) colorMaskGroupIndices.push(groups.length);
      groups.push(group);
    }
  }

  const hasColorMask = colorMaskGroupIndices.length > 0;
  const defaultColor = colorFromProto(p);
  return {
    ...baseEntity("vehicle", protoType, p, groups),
    data: {
      orientationCount: orientationCount ?? 1,
      ...(hasColorMask ? { colorMaskGroupIndices } : {}),
      ...(defaultColor ? { defaultColor } : {}),
    },
  };
}

async function distillTrain(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  let orientationCount = TRAIN_MAX_POSES;
  let colorMaskGroupIndex: number | undefined;

  const wheels = (p.wheels as { rotated?: RawSprite } | undefined)?.rotated;
  let wheelsGroupIndex: number | undefined;
  if (wheels) {
    wheelsGroupIndex = groups.length;
    for (const leaf of leafLayers(wheels).filter((l) => !l.draw_as_light)) {
      const { group, poseCount } = await distillTrainRotatedLeaf(
        bank,
        leaf,
        // Same layer as body (FBSR HIGHER_OBJECT_UNDER): wheels first via
        // group sub-index, then body; neighbor wagons' wheels can paint over
        // the previous body's end so coupler hooks stay visible in the gap.
        guessedLayer("object", "train wheels; same layer as body (FBSR)"),
      );
      orientationCount = Math.min(orientationCount, poseCount);
      groups.push(group);
    }
  }

  const pictures = p.pictures as { rotated?: RawSprite } | undefined;
  const rotated = pictures?.rotated;
  let backEqualsFront = false;
  if (rotated) {
    for (const leaf of leafLayers(rotated).filter((l) => !l.draw_as_light)) {
      if (leaf.back_equals_front === true) backEqualsFront = true;
      const isMask = leaf.apply_runtime_tint === true;
      const layerName: RenderLayerName = leaf.draw_as_shadow
        ? fpsrLayer("shadow", "draw_as_shadow leaf")
        : guessedLayer("object", "train body/mask; not in dump");
      const { group, poseCount } = await distillTrainRotatedLeaf(bank, leaf, layerName);
      orientationCount = Math.min(orientationCount, poseCount);
      if (isMask) colorMaskGroupIndex = groups.length;
      groups.push(group);
    }
  }

  // Artillery wagon: cannon barrel then base (FBSR paint order). Same orientation
  // indexing as the rolling-stock body; resolve applies cannonBaseShift.
  const cannonGroupIndices: number[] = [];
  for (const key of ["cannon_barrel_pictures", "cannon_base_pictures"] as const) {
    const rotatedCannon = (p[key] as { rotated?: RawSprite } | undefined)?.rotated;
    if (!rotatedCannon) continue;
    for (const leaf of leafLayers(rotatedCannon).filter((l) => !l.draw_as_light)) {
      const layerName: RenderLayerName = leaf.draw_as_shadow
        ? fpsrLayer("shadow", "artillery cannon shadow")
        : guessedLayer("object", "artillery cannon; RollingStock cannon_*_pictures");
      const { group, poseCount } = await distillTrainRotatedLeaf(bank, leaf, layerName);
      orientationCount = Math.min(orientationCount, poseCount);
      cannonGroupIndices.push(groups.length);
      groups.push(group);
    }
  }

  const defaultColor = colorFromProto(p);
  const jointDistance =
    typeof p.joint_distance === "number" && Number.isFinite(p.joint_distance)
      ? round4(p.joint_distance)
      : undefined;
  const connectionDistance =
    typeof p.connection_distance === "number" && Number.isFinite(p.connection_distance)
      ? round4(p.connection_distance)
      : undefined;
  const cannonBaseHeight =
    typeof p.cannon_base_height === "number" && Number.isFinite(p.cannon_base_height)
      ? round4(p.cannon_base_height)
      : undefined;
  const cannonBaseShiftWhenVertical =
    typeof p.cannon_base_shift_when_vertical === "number" &&
    Number.isFinite(p.cannon_base_shift_when_vertical)
      ? round4(p.cannon_base_shift_when_vertical)
      : undefined;
  const cannonBaseShiftWhenHorizontal =
    typeof p.cannon_base_shift_when_horizontal === "number" &&
    Number.isFinite(p.cannon_base_shift_when_horizontal)
      ? round4(p.cannon_base_shift_when_horizontal)
      : undefined;
  return {
    ...baseEntity("train", protoType, p, groups),
    data: {
      orientationCount,
      ...(wheelsGroupIndex != null ? { wheelsGroupIndex } : {}),
      ...(jointDistance != null ? { jointDistance } : {}),
      ...(connectionDistance != null ? { connectionDistance } : {}),
      ...(colorMaskGroupIndex != null ? { colorMaskGroupIndex } : {}),
      ...(defaultColor ? { defaultColor } : {}),
      ...(backEqualsFront ? { backEqualsFront: true } : {}),
      ...(cannonGroupIndices.length > 0 ? { cannonGroupIndices } : {}),
      ...(cannonBaseHeight != null ? { cannonBaseHeight } : {}),
      ...(cannonBaseShiftWhenVertical != null ? { cannonBaseShiftWhenVertical } : {}),
      ...(cannonBaseShiftWhenHorizontal != null ? { cannonBaseShiftWhenHorizontal } : {}),
    },
  };
}

/** Semi-transparent gray footprint sprite sized to the selection box. */
async function addPlaceholderVariant(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<SpriteVariant> {
  const box = boxOf(p, "selection_box");
  const tileW = Math.max(0.25, box[1][0] - box[0][0] || 1);
  const tileH = Math.max(0.25, box[1][1] - box[0][1] || 1);
  const sw = Math.max(1, Math.round(tileW * 32));
  const sh = Math.max(1, Math.round(tileH * 32));
  const rgba = Buffer.alloc(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    rgba[i * 4] = 140;
    rgba[i * 4 + 1] = 140;
    rgba[i * 4 + 2] = 150;
    rgba[i * 4 + 3] = 140;
  }
  const hash = createHash("sha256").update(rgba).update(`ph:${sw}x${sh}`).digest("hex");
  const frameId = await bank.add({ sw, sh, ox: 0, oy: 0, rgba, tw: sw, th: sh, hash });
  return { frame: frameId, scale: 1, shift: [0, 0] };
}

function hasUsableGraphics(def: EntityRenderDef): boolean {
  for (const g of def.graphics) {
    for (const arr of Object.values(g.variants)) {
      if (arr.some((v) => v != null)) return true;
    }
  }
  return false;
}

async function withPlaceholderIfEmpty(
  bank: FrameBank,
  p: Record<string, unknown>,
  def: EntityRenderDef,
  reason: string,
  placeholders: { name: string; reason: string }[],
  name: string,
): Promise<EntityRenderDef> {
  if (hasUsableGraphics(def)) return def;
  const variant = await addPlaceholderVariant(bank, p);
  placeholders.push({ name, reason });
  return {
    ...def,
    graphics: [
      {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        variants: { default: [variant] },
      },
    ],
    data: { ...def.data, placeholder: true, placeholderReason: reason },
  };
}

async function finalizeEntityDef(
  bank: FrameBank,
  p: Record<string, unknown>,
  def: EntityRenderDef,
  placeholders: { name: string; reason: string }[],
  name: string,
  emptyReason: string,
): Promise<EntityRenderDef> {
  let finalized = await withPlaceholderIfEmpty(bank, p, def, emptyReason, placeholders, name);
  finalized = withWireAnchors(finalized, p);
  finalized = await withCircuitConnectorGraphics(bank, finalized, p);
  finalized = await withBeltConnectorGraphics(bank, finalized, p);
  finalized = await withBeltReaderGraphics(bank, finalized, p);
  return withPipeCovers(bank, finalized, p);
}

async function distillCombinatorSprites(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const sprites = p.sprites as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, sprites, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "direction4",
  });
  const def = baseEntity("simple", protoType, p, graphics);
  const symbolFields: Record<string, string> =
    protoType === "arithmetic-combinator"
      ? {
          "+": "plus_symbol_sprites",
          "-": "minus_symbol_sprites",
          "*": "multiply_symbol_sprites",
          "/": "divide_symbol_sprites",
          "%": "modulo_symbol_sprites",
          "^": "power_symbol_sprites",
          "<<": "left_shift_symbol_sprites",
          ">>": "right_shift_symbol_sprites",
          AND: "and_symbol_sprites",
          OR: "or_symbol_sprites",
          XOR: "xor_symbol_sprites",
        }
      : protoType === "decider-combinator"
        ? {
            "=": "equal_symbol_sprites",
            ">": "greater_symbol_sprites",
            "<": "less_symbol_sprites",
            "≠": "not_equal_symbol_sprites",
            "≤": "less_or_equal_symbol_sprites",
            "≥": "greater_or_equal_symbol_sprites",
          }
        : protoType === "selector-combinator"
          ? {
              count: "count_symbol_sprites",
              random: "random_symbol_sprites",
              max: "max_symbol_sprites",
              min: "min_symbol_sprites",
              quality: "quality_symbol_sprites",
              "rocket-capacity": "rocket_capacity_sprites",
              "stack-size": "stack_size_sprites",
              time: "time_symbol_sprites",
            }
          : {};

  const symbols: Record<string, (SpriteVariant | null)[]> = {};
  for (const [key, field] of Object.entries(symbolFields)) {
    const sprite = p[field] as RawSprite | undefined;
    if (!sprite || !isSprite4Way(sprite)) continue;
    const variants: (SpriteVariant | null)[] = [];
    for (const direction of dirs4(sprite)) {
      const leaf = leafLayers(direction).find(
        (candidate) =>
          !candidate.draw_as_shadow && !candidate.apply_runtime_tint && !candidate.draw_as_light,
      );
      if (!leaf) {
        variants.push(null);
        continue;
      }
      const info = await bank.addSprite(leaf, 0, 0);
      variants.push(bank.toVariant(info));
    }
    if (variants.some(Boolean)) symbols[key] = variants;
  }

  return Object.keys(symbols).length > 0
    ? { ...def, data: { ...def.data, combinatorGraphics: { symbols } } }
    : def;
}

async function distillPowerSwitch(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const anim = p.power_on_animation as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, anim, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
    frame: 0,
  });
  return baseEntity("simple", "power-switch", p, graphics);
}

async function distillLoader(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  // Same structure shape as underground-belt (direction_in / direction_out).
  return {
    ...(await distillUndergroundBelt(bank, p, protoType)),
    kind: "loader",
    protoType,
  };
}

async function distillLinkedBelt(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  return distillLoader(bank, p, "linked-belt");
}

async function distillRoboport(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const base = p.base as RawSprite | undefined;
  const graphics = await layersFromSprite(bank, base, {
    layer: guessedLayer("object", "entity body; dump has no render_layer"),
    indexing: "single",
  });
  return baseEntity("simple", "roboport", p, graphics);
}

async function distillRocketSilo(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  for (const field of ["shadow_sprite", "base_day_sprite", "base_front_sprite"] as const) {
    const spr = p[field] as RawSprite | undefined;
    if (!spr) continue;
    groups.push(
      ...(await layersFromSprite(bank, spr, {
        layer:
          field === "shadow_sprite"
            ? fpsrLayer("shadow", "rocket-silo shadow_sprite")
            : guessedLayer("object", "rocket-silo body; not in dump"),
        indexing: "single",
      })),
    );
  }
  return baseEntity("simple", "rocket-silo", p, groups);
}

async function distillTrainStop(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  let colorMaskGroupIndex: number | undefined;

  // Ground pad under the rail (FBSR: RAIL_SCREW).
  groups.push(
    ...(await layersFromSprite(bank, p.rail_overlay_animations as RawSprite | undefined, {
      layer: guessedLayer("rail-screw", "train-stop rail_overlay_animations"),
      indexing: "direction4",
      frame: 0,
    })),
  );

  // Bottom post + shadow (object / shadow). Trains on `object` may cover this —
  // the top flag below is what must stay visible.
  groups.push(
    ...(await layersFromSprite(bank, p.animations as RawSprite | undefined, {
      layer: guessedLayer("object", "train-stop animations (bottom)"),
      indexing: "direction4",
      frame: 0,
    })),
  );

  // Top board + tint mask on `train-stop-top` (above rolling stock `object`).
  const top = p.top_animations as RawSprite | undefined;
  if (top && isSprite4Way(top)) {
    const dirs = dirs4(top);
    const byLeaf = new Map<string, { group: LayerGroup; isMask: boolean }>();
    for (let di = 0; di < 4; di++) {
      const leaves = leafLayers(dirs[di]).filter((l) => !l.draw_as_light);
      let leafIdx = 0;
      for (const leaf of leaves) {
        const info = await bank.addSprite(leaf, 0, 0);
        const isMask = leaf.apply_runtime_tint === true;
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("train-stop-top", "train-stop top_animations above trains");
        const key = `${layerName}:${isMask ? "m" : info.shadow ? "s" : "o"}:${leafIdx}`;
        leafIdx++;
        let entry = byLeaf.get(key);
        if (!entry) {
          entry = {
            isMask,
            group: {
              layer: layerName,
              indexing: "direction4",
              variants: { default: [null, null, null, null] },
            },
          };
          byLeaf.set(key, entry);
        }
        const arr = entry.group.variants.default;
        if (!arr) continue;
        arr[di] = bank.toVariant(info);
      }
    }
    for (const { group, isMask } of byLeaf.values()) {
      if (isMask) colorMaskGroupIndex = groups.length;
      groups.push(group);
    }
  }

  const defaultColor = colorFromProto(p);
  return {
    ...baseEntity("simple", "train-stop", p, groups),
    data: {
      ...(colorMaskGroupIndex != null ? { colorMaskGroupIndex } : {}),
      ...(defaultColor ? { defaultColor } : {}),
    },
  };
}

async function distillTurret(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const groups: LayerGroup[] = [];
  const gs = p.graphics_set as { base_visualisation?: { animation?: RawSprite } } | undefined;
  if (gs?.base_visualisation?.animation) {
    groups.push(
      ...(await layersFromSprite(bank, gs.base_visualisation.animation, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        frame: 0,
      })),
    );
  }
  if (p.base_picture) {
    groups.push(
      ...(await layersFromSprite(bank, p.base_picture as RawSprite, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        frame: 0,
      })),
    );
  }
  const folded = (p.folded_animation ?? p.cannon_base_pictures) as RawSprite | undefined;
  if (folded) {
    groups.push(
      ...(await layersFromSprite(bank, folded, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "direction4",
        frame: 0,
        assumeDirectionCount: 4,
      })),
    );
  }
  return baseEntity("simple", protoType, p, groups);
}

async function distillGraphicsSetPictureArray(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind = "simple",
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        picture?: RawSprite | RawSprite[] | Record<string, RawSprite | RawSprite[]>;
        animation?: RawSprite;
        idle_animation?: RawSprite;
        structure?: RawSprite;
      }
    | undefined;
  const groups: LayerGroup[] = [];

  const addPic = async (pic: RawSprite | undefined) => {
    if (!pic) return;
    groups.push(
      ...(await layersFromSprite(bank, pic, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
      })),
    );
  };

  const pics = gs?.picture;
  if (pics && typeof pics === "object" && !Array.isArray(pics) && isSprite4Way(pics as RawSprite)) {
    // 4-way picture where each dir may be an array of layered sprites.
    const dirNames = ["north", "east", "south", "west"] as const;
    const leafGroups = new Map<string, LayerGroup>();
    for (let di = 0; di < 4; di++) {
      const dirName = dirNames[di];
      if (dirName === undefined) continue;
      const rawDir = (pics as Record<string, RawSprite | RawSprite[]>)[dirName];
      const list = Array.isArray(rawDir) ? rawDir : rawDir ? [rawDir] : [];
      let leafIdx = 0;
      for (const entry of list) {
        for (const leaf of leafLayers(entry)) {
          if (skipIdleDecorativeLeaf(leaf)) continue;
          const info = await bank.addSprite(leaf, 0, 0);
          const layerName: RenderLayerName = info.shadow
            ? fpsrLayer("shadow", "draw_as_shadow leaf")
            : guessedLayer("object", "entity body; not in dump");
          const key = `${layerName}:${leafIdx}`;
          leafIdx++;
          let g = leafGroups.get(key);
          if (!g) {
            g = {
              layer: layerName,
              indexing: "direction4",
              variants: { default: [null, null, null, null] },
            };
            leafGroups.set(key, g);
          }
          const arr = g.variants.default;
          if (arr) arr[di] = bank.toVariant(info);
        }
      }
    }
    groups.push(...leafGroups.values());
  } else if (Array.isArray(pics)) {
    for (const pic of pics) await addPic(pic);
  } else if (pics) {
    await addPic(pics as RawSprite);
  }

  if (groups.length === 0 && gs?.structure) {
    await addPic(gs.structure);
  }
  if (groups.length === 0 && (gs?.animation || gs?.idle_animation)) {
    groups.push(
      ...(await layersFromSprite(bank, gs.animation ?? gs.idle_animation, {
        layer: guessedLayer("object", "entity body; dump has no render_layer"),
        indexing: "single",
        frame: 0,
      })),
    );
  }
  // Platform variant for cargo-bay when grounded set is empty.
  if (groups.length === 0) {
    const pgs = p.platform_graphics_set as { picture?: RawSprite | RawSprite[] } | undefined;
    const pp = pgs?.picture;
    if (Array.isArray(pp)) {
      for (const pic of pp) await addPic(pic);
    } else if (pp) {
      await addPic(pp);
    }
  }
  await appendCargoStationIdleHatches(bank, groups, p);
  return baseEntity(kind, protoType, p, groups);
}

/**
 * Closed cargo-hub giga hatches. Without these, hub-3's hatch pits read as
 * black voids against empty space.
 */
async function appendCargoStationIdleHatches(
  bank: FrameBank,
  groups: LayerGroup[],
  p: Record<string, unknown>,
): Promise<void> {
  const csp = p.cargo_station_parameters as
    | {
        giga_hatch_definitions?: Array<{
          hatch_graphics_back?: RawSprite;
          hatch_graphics_front?: RawSprite;
          hatch_render_layer_back?: string;
          hatch_render_layer_front?: string;
        }>;
      }
    | undefined;
  for (const hatch of csp?.giga_hatch_definitions ?? []) {
    for (const [spr, rl] of [
      [hatch.hatch_graphics_back, hatch.hatch_render_layer_back],
      [hatch.hatch_graphics_front, hatch.hatch_render_layer_front],
    ] as const) {
      if (!spr) continue;
      const layer =
        officialLayer(rl) ??
        guessedLayer("object", "cargo station idle giga hatch; dump has no render_layer");
      groups.push(
        ...(await layersFromSprite(bank, spr, {
          layer,
          indexing: "single",
          frame: 0,
        })),
      );
    }
  }
}

async function distillFusionGenerator(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        north_graphics_set?: { animation?: RawSprite };
        east_graphics_set?: { animation?: RawSprite };
        south_graphics_set?: { animation?: RawSprite };
        west_graphics_set?: { animation?: RawSprite };
      }
    | undefined;
  if (gs?.north_graphics_set?.animation || gs?.east_graphics_set?.animation) {
    const dirs = [
      gs.north_graphics_set?.animation,
      gs.east_graphics_set?.animation,
      gs.south_graphics_set?.animation,
      gs.west_graphics_set?.animation,
    ] as const;
    const leafGroups = new Map<string, LayerGroup>();
    for (let di = 0; di < 4; di++) {
      const anim = dirs[di] ?? dirs[0];
      if (!anim) continue;
      let leafIdx = 0;
      for (const leaf of leafLayers(anim)) {
        if (leaf.apply_runtime_tint || leaf.draw_as_light) continue;
        const info = await bank.addSprite(leaf, 0, 0);
        const layerName: RenderLayerName = info.shadow
          ? fpsrLayer("shadow", "draw_as_shadow leaf")
          : guessedLayer("object", "entity body; not in dump");
        const key = `${layerName}:${leafIdx}`;
        leafIdx++;
        let g = leafGroups.get(key);
        if (!g) {
          g = {
            layer: layerName,
            indexing: "direction4",
            variants: { default: [null, null, null, null] },
          };
          leafGroups.set(key, g);
        }
        const arr = g.variants.default;
        if (arr) arr[di] = bank.toVariant(info);
      }
    }
    return withFluidData(baseEntity("simple", "fusion-generator", p, [...leafGroups.values()]), p);
  }
  return distillFusion(bank, p, "fusion-generator");
}

async function distillFusion(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
): Promise<EntityRenderDef> {
  const gs = p.graphics_set as
    | {
        structure?: RawSprite;
        animation?: RawSprite;
        /** Idle neighbour-port patches; main structure has transparent cutouts here. */
        connections_graphics?: Array<{ pictures?: RawSprite }>;
      }
    | undefined;
  if (gs?.structure) {
    const graphics = await layersFromSprite(bank, gs.structure, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: "single",
    });
    // Frame 0 = unconnected port cover. Connected neighbour states are runtime.
    for (const conn of gs.connections_graphics ?? []) {
      if (!conn.pictures) continue;
      graphics.push(
        ...(await layersFromSprite(bank, conn.pictures, {
          layer: guessedLayer("object", "fusion reactor idle connection patch"),
          indexing: "single",
          frame: 0,
        })),
      );
    }
    return withFluidData(baseEntity("simple", protoType, p, graphics), p);
  }
  return withFluidData(await distillGraphicsSetAnimation(bank, p, protoType, "simple"), p);
}

async function distillGenericFallback(
  bank: FrameBank,
  p: Record<string, unknown>,
  protoType: string,
  kind: EntityKind,
): Promise<EntityRenderDef> {
  // Try common Factorio graphics fields in priority order.
  const candidates: (RawSprite | undefined)[] = [
    (p.graphics_set as { animation?: RawSprite } | undefined)?.animation,
    (p.graphics_set as { idle_animation?: RawSprite } | undefined)?.idle_animation,
    (p.graphics_set as { structure?: RawSprite } | undefined)?.structure,
    Array.isArray((p.graphics_set as { picture?: unknown } | undefined)?.picture)
      ? undefined
      : ((p.graphics_set as { picture?: RawSprite } | undefined)?.picture as RawSprite | undefined),
    p.picture as RawSprite | undefined,
    p.pictures as RawSprite | undefined,
    p.sprites as RawSprite | undefined,
    p.sprite as RawSprite | undefined,
    p.animation as RawSprite | undefined,
    p.animations as RawSprite | undefined,
    p.idle as RawSprite | undefined,
    p.picture_off as RawSprite | undefined,
    p.picture_safe as RawSprite | undefined,
    p.power_on_animation as RawSprite | undefined,
    p.off_animation as RawSprite | undefined,
    p.base as RawSprite | undefined,
    (p.chargable_graphics as { picture?: RawSprite } | undefined)?.picture,
    (p.robot_door as { animation?: RawSprite } | undefined)?.animation,
  ];

  // graphics_set.picture as array
  const picArr = (p.graphics_set as { picture?: RawSprite[] } | undefined)?.picture;
  if (Array.isArray(picArr) && picArr.length > 0) {
    return distillGraphicsSetPictureArray(bank, p, protoType, kind);
  }

  for (const spr of candidates) {
    if (!spr) continue;
    const graphics = await layersFromSprite(bank, spr, {
      layer: guessedLayer("object", "entity body; dump has no render_layer"),
      indexing: isSprite4Way(spr) ? "direction4" : "single",
      frame: 0,
    });
    if (graphics.length > 0 && hasUsableGraphics(baseEntity(kind, protoType, p, graphics))) {
      return baseEntity(kind, protoType, p, graphics);
    }
  }
  return baseEntity(kind, protoType, p, []);
}

function kindForProtoType(protoType: string): EntityKind {
  switch (protoType) {
    case "transport-belt":
      return "belt";
    case "underground-belt":
      return "underground-belt";
    case "loader":
    case "loader-1x1":
    case "linked-belt":
      return "loader";
    case "splitter":
    case "lane-splitter":
      return "splitter";
    case "pipe":
    case "infinity-pipe":
      return "pipe";
    case "heat-pipe":
      return "heat-pipe";
    case "wall":
      return "wall";
    case "gate":
      return "gate";
    case "inserter":
      return "inserter";
    case "assembling-machine":
      return "assembler";
    case "straight-rail":
    case "half-diagonal-rail":
    case "curved-rail-a":
    case "curved-rail-b":
    case "legacy-straight-rail":
    case "legacy-curved-rail":
    case "elevated-straight-rail":
    case "elevated-half-diagonal-rail":
    case "elevated-curved-rail-a":
    case "elevated-curved-rail-b":
    case "rail-ramp":
      return "rail";
    case "rail-signal":
    case "rail-chain-signal":
      return "rail-signal";
    case "locomotive":
    case "cargo-wagon":
    case "fluid-wagon":
    case "artillery-wagon":
    case "infinity-cargo-wagon":
      return "train";
    default:
      return "simple";
  }
}

async function distillEntity(
  bank: FrameBank,
  name: string,
  protoType: string,
  p: Record<string, unknown>,
  placeholders: { name: string; reason: string }[],
): Promise<EntityRenderDef> {
  const kind = kindForProtoType(protoType);
  let def: EntityRenderDef;

  try {
    switch (protoType) {
      case "container":
      case "proxy-container":
      case "linked-container":
      case "simple-entity-with-owner":
      case "simple-entity-with-force":
      case "electric-energy-interface":
      case "heat-interface":
        def = await distillSimplePicture(bank, p, protoType);
        break;
      case "logistic-container":
      case "infinity-container": {
        if (p.picture) {
          def = await distillSimplePicture(bank, p, protoType);
        } else {
          const door = p.robot_door as { animation?: RawSprite } | undefined;
          const graphics = await layersFromSprite(bank, door?.animation, {
            layer: guessedLayer("object", "entity body; dump has no render_layer"),
            indexing: "single",
            frame: 0,
          });
          def = baseEntity("simple", protoType, p, graphics);
        }
        break;
      }
      case "assembling-machine": {
        def = await distillAssembler(bank, p, protoType);
        break;
      }
      case "furnace": {
        const gs = p.graphics_set as
          | {
              animation?: RawSprite;
              idle_animation?: RawSprite;
            }
          | undefined;
        const anim = gs?.animation ?? gs?.idle_animation;
        if (anim && isSprite4Way(anim)) {
          def = await distillDirection4Animation(bank, p, protoType, "simple");
        } else {
          def = await distillGraphicsSetAnimation(bank, p, protoType, "simple");
        }
        break;
      }
      case "inserter":
        def = await distillInserter(bank, p);
        break;
      case "electric-pole":
        def = await distillElectricPole(bank, p);
        break;
      case "solar-panel":
        def = await distillSimplePicture(bank, p, protoType);
        break;
      case "accumulator":
      case "lightning-attractor":
        def = await distillAccumulator(bank, p);
        // distillAccumulator hardcodes protoType "accumulator"
        def = { ...def, protoType };
        break;
      case "lab":
        def = await distillLab(bank, p);
        def = { ...def, protoType };
        break;
      case "radar":
        def = await distillRadar(bank, p);
        break;
      case "beacon":
        def = await distillBeacon(bank, p);
        break;
      case "mining-drill":
        def = await distillMiningDrill(bank, p, protoType);
        break;
      case "pipe-to-ground": {
        const pictures = p.pictures as RawSprite;
        const graphics = await layersFromSprite(bank, pictures, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "direction4",
        });
        def = withFluidData(baseEntity("simple", protoType, p, graphics), p);
        break;
      }
      case "pipe":
        def = await distillPipe(bank, p);
        break;
      case "infinity-pipe": {
        // Same picture keys as pipe.
        def = await distillPipe(bank, p);
        def = { ...def, protoType };
        break;
      }
      case "heat-pipe":
        def = await distillHeatPipe(bank, p);
        break;
      case "wall":
        def = await distillWall(bank, p);
        break;
      case "gate":
        def = await distillGate(bank, p);
        break;
      case "boiler":
        def = await distillBoiler(bank, p, protoType);
        break;
      case "storage-tank":
        def = await distillStorageTank(bank, p);
        break;
      case "pump":
      case "valve":
        def = await distillPump(bank, p);
        def = { ...def, protoType };
        break;
      case "offshore-pump":
        def = await distillOffshorePump(bank, p);
        break;
      case "generator":
      case "burner-generator":
        def = await distillSteamEngine(bank, p, protoType);
        break;
      case "reactor":
        def = await distillReactor(bank, p);
        def = { ...def, protoType };
        break;
      case "transport-belt":
        def = await distillBelt(bank, p, protoType);
        break;
      case "underground-belt":
        def = await distillUndergroundBelt(bank, p, protoType);
        break;
      case "loader":
      case "loader-1x1":
        def = await distillLoader(bank, p, protoType);
        break;
      case "linked-belt":
        def = await distillLinkedBelt(bank, p);
        break;
      case "splitter":
      case "lane-splitter":
        def = await distillSplitter(bank, p, protoType);
        break;
      case "straight-rail":
      case "half-diagonal-rail":
      case "curved-rail-a":
      case "curved-rail-b":
      case "legacy-straight-rail":
      case "legacy-curved-rail":
        def = await distillRail(bank, p, protoType, false);
        break;
      case "elevated-straight-rail":
      case "elevated-half-diagonal-rail":
      case "elevated-curved-rail-a":
      case "elevated-curved-rail-b":
        def = await distillRail(bank, p, protoType, true);
        break;
      case "rail-ramp":
        def = await distillRailRamp(bank, p);
        break;
      case "rail-support":
        def = await distillRailSupport(bank, p);
        break;
      case "rail-signal":
      case "rail-chain-signal":
        def = await distillRailSignal(bank, p, protoType);
        break;
      case "locomotive":
      case "cargo-wagon":
      case "fluid-wagon":
      case "artillery-wagon":
      case "infinity-cargo-wagon":
        def = await distillTrain(bank, p, protoType);
        break;
      case "arithmetic-combinator":
      case "decider-combinator":
      case "constant-combinator":
      case "selector-combinator":
      case "display-panel":
        def = await distillCombinatorSprites(bank, p, protoType);
        break;
      case "power-switch":
        def = await distillPowerSwitch(bank, p);
        break;
      case "roboport":
        def = await distillRoboport(bank, p);
        break;
      case "rocket-silo":
        def = await distillRocketSilo(bank, p);
        break;
      case "train-stop":
        def = await distillTrainStop(bank, p);
        break;
      case "ammo-turret":
      case "electric-turret":
      case "fluid-turret":
      case "artillery-turret":
        def = await distillTurret(bank, p, protoType);
        break;
      case "space-platform-hub":
      case "cargo-bay":
      case "cargo-landing-pad":
        def = await distillGraphicsSetPictureArray(bank, p, protoType);
        break;
      case "fusion-reactor":
        def = await distillFusion(bank, p, protoType);
        break;
      case "fusion-generator":
        def = await distillFusionGenerator(bank, p);
        break;
      case "thruster":
        def = await distillThruster(bank, p);
        break;
      case "asteroid-collector":
        def = await distillAsteroidCollector(bank, p);
        break;
      case "agricultural-tower":
        def = await distillAgriculturalTower(bank, p, protoType);
        break;
      case "lamp":
        def = await layersFromSprite(bank, p.picture_off as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "land-mine":
        def = await layersFromSprite(bank, p.picture_safe as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "programmable-speaker":
        def = await layersFromSprite(bank, p.sprite as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "car":
        def = await distillVehicle(bank, p, protoType);
        break;
      case "spider-vehicle":
        def = await layersFromSprite(
          bank,
          (p.animation ??
            (p.graphics_set as { animation?: RawSprite } | undefined)?.animation) as RawSprite,
          {
            layer: guessedLayer("object", "entity body; dump has no render_layer"),
            indexing: "single",
            frame: 0,
          },
        ).then((g) => baseEntity("simple", protoType, p, g));
        break;
      case "construction-robot":
      case "logistic-robot":
        def = await layersFromSprite(bank, p.idle as RawSprite, {
          layer: guessedLayer("object", "entity body; dump has no render_layer"),
          indexing: "single",
          frame: 0,
        }).then((g) => baseEntity("simple", protoType, p, g));
        break;
      default:
        def = await distillGenericFallback(bank, p, protoType, kind);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    def = baseEntity(kind, protoType, p, []);
    return finalizeEntityDef(bank, p, def, placeholders, name, `distill error: ${msg}`);
  }

  // Ensure kind matches heuristic (some helpers hardcode kind).
  if (def.kind !== kind && kind !== "simple") {
    // Keep specialized kinds from helpers (e.g. pipe/belt); only override when
    // heuristic is more specific than simple default from a helper.
    if (def.kind === "simple" || def.protoType !== protoType) {
      def = { ...def, kind, protoType };
    }
  } else {
    def = { ...def, protoType };
  }

  return finalizeEntityDef(bank, p, def, placeholders, name, "no usable graphics resolved");
}

async function distillIcon(
  bank: FrameBank,
  raw: DataRaw,
  category:
    | "item"
    | "recipe"
    | "fluid"
    | "virtual-signal"
    | "quality"
    | "entity"
    | "space-location"
    | "asteroid-chunk",
  name: string,
  protoTypeHint?: string,
): Promise<number | undefined> {
  const tryProto = (type: string, n: string): Record<string, unknown> | undefined => {
    const p = raw[type]?.[n] as Record<string, unknown> | undefined;
    if (!p) return undefined;
    if (typeof p.icon === "string" || Array.isArray(p.icons)) return p;
    return undefined;
  };

  const findItem = (itemName = name): Record<string, unknown> | undefined => {
    for (const [type, protos] of Object.entries(raw)) {
      const p = protos?.[itemName];
      if (!p || typeof p !== "object" || typeof p.stack_size !== "number") continue;
      const found = tryProto(type, itemName);
      if (found) return found;
    }
    return undefined;
  };

  let source: Record<string, unknown> | undefined;
  if (category === "item") source = findItem();
  else if (category === "entity") {
    source = protoTypeHint ? tryProto(protoTypeHint, name) : undefined;
    if (!source) {
      for (const type of Object.keys(raw)) {
        source = tryProto(type, name);
        if (source) break;
      }
    }
  } else if (category === "recipe") {
    const recipe = raw.recipe?.[name] as Record<string, unknown> | undefined;
    source = tryProto("recipe", name);
    if (!source && recipe) {
      const results = recipe.results as unknown[] | undefined;
      const firstResult = Array.isArray(results) ? results[0] : undefined;
      const product =
        (typeof recipe.main_product === "string" ? recipe.main_product : undefined) ??
        (typeof recipe.result === "string" ? recipe.result : undefined) ??
        (typeof firstResult === "string"
          ? firstResult
          : firstResult && typeof firstResult === "object"
            ? ((firstResult as { name?: unknown }).name as string | undefined)
            : undefined);
      if (product) source = findItem(product) ?? tryProto("fluid", product);
    }
    if (!source) source = findItem();
  } else {
    source = tryProto(category, name);
  }

  if (!source) return undefined;
  type IconLayer = {
    icon: string;
    icon_size?: number;
    scale?: number;
    shift?: [number, number];
    tint?: RawSprite["tint"];
  };
  const rootSize = (source.icon_size as number | undefined) ?? 64;
  const layers: IconLayer[] = Array.isArray(source.icons)
    ? (source.icons as IconLayer[])
    : typeof source.icon === "string"
      ? [{ icon: source.icon, icon_size: rootSize }]
      : [];
  if (layers.length === 0) return undefined;

  const { default: sharp } = await import("sharp");
  const { trimRgba } = await import("./sprite.js");
  const composites: {
    input: Buffer;
    raw: { width: number; height: number; channels: 4 };
    left: number;
    top: number;
  }[] = [];
  for (const layer of layers) {
    if (!layer.icon) continue;
    const size = layer.icon_size ?? rootSize;
    const scale = layer.scale ?? 1;
    const target = Math.max(1, Math.round(64 * scale));
    const rendered = await sharp(resolveSpritePath(layer.icon))
      .extract({ left: 0, top: 0, width: size, height: size })
      .resize(target, target, { fit: "fill", kernel: "nearest" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const tint = normalizeTint(layer.tint);
    if (tint) {
      for (let i = 0; i < rendered.data.length; i += 4) {
        rendered.data[i] = Math.round((rendered.data[i] ?? 0) * tint[0]);
        rendered.data[i + 1] = Math.round((rendered.data[i + 1] ?? 0) * tint[1]);
        rendered.data[i + 2] = Math.round((rendered.data[i + 2] ?? 0) * tint[2]);
        rendered.data[i + 3] = Math.round((rendered.data[i + 3] ?? 0) * tint[3]);
      }
    }
    const shift = layer.shift ?? [0, 0];
    composites.push({
      input: rendered.data,
      raw: { width: target, height: target, channels: 4 },
      left: Math.round((64 - target) / 2 + shift[0]),
      top: Math.round((64 - target) / 2 + shift[1]),
    });
  }
  const composed = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .raw()
    .toBuffer();
  const trimmed = await trimRgba(composed, 64, 64);
  const hash = createHash("sha256").update(trimmed.rgba).digest("hex");
  return bank.add({
    sw: 64,
    sh: 64,
    ox: trimmed.ox,
    oy: trimmed.oy,
    rgba: trimmed.rgba.length ? trimmed.rgba : Buffer.from([0, 0, 0, 0]),
    tw: trimmed.tw || 1,
    th: trimmed.th || 1,
    hash,
  });
}

async function distillTile(bank: FrameBank, raw: DataRaw, name: string): Promise<TileRenderDef> {
  const t = proto(raw, "tile", name);
  const variants = t.variants as {
    material_background?: {
      picture: string;
      count?: number;
      scale?: number;
      line_length?: number;
      x?: number;
      y?: number;
    };
    main?: { picture: string; count?: number; size?: number; scale?: number }[];
    material_texture_width_in_tiles?: number;
    material_texture_height_in_tiles?: number;
  };

  const mapColor = t.map_color as number[] | undefined;
  const mapColorRgba = (
    fallback: [number, number, number, number],
  ): [number, number, number, number] =>
    mapColor
      ? [
          round4((mapColor[0] ?? 0) > 1 ? (mapColor[0] ?? 0) / 255 : (mapColor[0] ?? 0)),
          round4((mapColor[1] ?? 0) > 1 ? (mapColor[1] ?? 0) / 255 : (mapColor[1] ?? 0)),
          round4((mapColor[2] ?? 0) > 1 ? (mapColor[2] ?? 0) / 255 : (mapColor[2] ?? 0)),
          round4((mapColor[3] ?? 1) > 1 ? (mapColor[3] ?? 1) / 255 : (mapColor[3] ?? 1)),
        ]
      : fallback;

  const layer = fpsrLayer("ground-tile", "tile ground; fpsr name ≈ under-tiles");

  if (variants.material_background) {
    const mb = variants.material_background;
    const picture = mb.picture;
    const count = mb.count ?? 1;
    const scale = mb.scale ?? 0.5;
    const patchW = variants.material_texture_width_in_tiles ?? 8;
    const patchH = variants.material_texture_height_in_tiles ?? 8;
    const abs = resolveSpritePath(picture);
    const color = await averageColor(abs);
    const tilePx = Math.round(32 / scale);
    const patchPxW = patchW * tilePx;
    const patchPxH = patchH * tilePx;
    const lineLength = mb.line_length ?? 0;
    const sheetX = mb.x ?? 0;
    const sheetY = mb.y ?? 0;
    const sheetCols = lineLength > 0 ? lineLength : count;
    const sheetRows = lineLength > 0 ? Math.ceil(count / lineLength) : 1;
    const sheetPxW = sheetCols * patchPxW;
    const sheetPxH = sheetRows * patchPxH;
    const sheetCrop = await cropFileRect(abs, sheetX, sheetY, sheetPxW, sheetPxH);
    const sheet = await bank.add(sheetCrop);

    return {
      layer,
      color: mapColorRgba(color),
      material: {
        sheet,
        count,
        patchW,
        patchH,
        tilePx,
        ...(lineLength > 0 ? { lineLength } : {}),
        ...(sheetX !== 0 ? { sheetX } : {}),
        ...(sheetY !== 0 ? { sheetY } : {}),
      },
    };
  }

  // `variants.main` path: only size-1 sheet today. Multi-size 2×2 / 4×4 packing
  // (stone-path) and neighbor transitions are deferred.
  const main0 = variants.main?.[0];
  if (!main0?.picture) throw new Error(`tile ${name} has no material picture`);

  const picture = main0.picture;
  const count = main0.count ?? 1;
  const scale = main0.scale ?? 0.5;
  const abs = resolveSpritePath(picture);
  const color = await averageColor(abs);
  const tilePx = Math.round(32 / scale);
  const frameCount = Math.min(4, Math.max(1, count));
  const frames: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const x = (i * tilePx) % Math.max(tilePx, tilePx * Math.min(count, 16));
    const y = 0;
    const crop = await cropFileRect(abs, x, y, tilePx, tilePx);
    frames.push(await bank.add(crop));
  }

  return {
    layer,
    color: mapColorRgba(color),
    frames,
  };
}

function discoverItemIconNames(raw: DataRaw): string[] {
  const names = new Set<string>();
  for (const protos of Object.values(raw)) {
    for (const [name, p] of Object.entries(protos ?? {})) {
      if (p && typeof p === "object" && typeof p.stack_size === "number") names.add(name);
    }
  }
  return [...names].sort();
}

export interface DistillReport {
  placeholders: { name: string; reason: string }[];
  entityCount: number;
  tileCount: number;
  kindCounts: Record<string, number>;
  packing?: {
    sourceFrames: number;
    packedFrames: number;
    sourcePixels: number;
    packedPixels: number;
    clonedPixelRatio: number;
  };
  tierPacking?: Record<
    "1x" | "2x",
    {
      frames: number;
      atlases: number;
      decodedPixels: number;
      blobBytes: number;
    }
  >;
}

async function directoryBytes(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir);
    let total = 0;
    for (const entry of entries) {
      const info = await stat(path.join(dir, entry));
      if (info.isFile()) total += info.size;
    }
    return total;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function publishAtomic(staging: string, target: string): Promise<void> {
  const backup = `${target}.previous-${process.pid}`;
  let hadTarget = false;
  try {
    await rename(target, backup);
    hadTarget = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, target);
  } catch (error) {
    if (hadTarget) await rename(backup, target);
    throw error;
  }
  if (hadTarget) await rm(backup, { recursive: true, force: true });
}

const MAX_BUNDLE_GROWTH_RATIO = 1.5;

export interface DistillAndPackOptions {
  /** Skip the bundle-size guard (e.g. after intentional tile-material growth). */
  allowBundleGrowth?: boolean;
}

export async function distillAndPack(options: DistillAndPackOptions = {}): Promise<RenderDb> {
  const paths = getPipelinePaths();
  pipeCoversCache = undefined;
  clearImageCache();
  console.log("distill: loading data-raw-dump.json…");
  const text = await readFile(paths.dumpPath, "utf8");
  const raw = JSON.parse(text) as DataRaw;
  console.log(`distill: parsed ${(text.length / 1e6).toFixed(1)} MB`);

  const bank = new FrameBank();
  const entities: Record<string, EntityRenderDef> = {};
  const placeholders: { name: string; reason: string }[] = [];
  const placeable = discoverPlaceableEntities(raw);
  console.log(`distill: discovered ${placeable.length} placeable entities`);

  for (const { name, type, proto: p } of placeable) {
    process.stdout.write(`  entity ${name} [${type}]…`);
    const def = await distillEntity(bank, name, type, p, placeholders);
    entities[name] = def;
    const ph = placeholders.find((x) => x.name === name);
    console.log(
      ph ? ` PLACEHOLDER (${ph.reason})` : ` ok (${def.kind}, ${def.graphics.length} layer groups)`,
    );
  }

  const tileNames = discoverPlaceableTiles(raw);
  const tilePlacingItems = discoverTilePlacingItems(raw);
  const tiles: Record<string, TileRenderDef> = {};
  for (const name of tileNames) {
    process.stdout.write(`  tile ${name}…`);
    try {
      const def = await distillTile(bank, raw, name);
      const placingItem = tilePlacingItems[name];
      if (placingItem) def.item = placingItem;
      tiles[name] = def;
      console.log(" ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` SKIP (${msg})`);
    }
  }

  const icons: Record<string, number> = {};
  const iconScales: Record<string, number> = {};
  const iconJobs: {
    key: string;
    cat:
      | "item"
      | "recipe"
      | "fluid"
      | "virtual-signal"
      | "quality"
      | "entity"
      | "space-location"
      | "asteroid-chunk";
    name: string;
    type?: string;
  }[] = [];

  for (const { name, type } of placeable) {
    iconJobs.push({ key: `entity/${name}`, cat: "entity", name, type });
    iconJobs.push({ key: `item/${name}`, cat: "item", name });
  }
  for (const name of Object.keys(raw.recipe ?? {}).sort()) {
    iconJobs.push({ key: `recipe/${name}`, cat: "recipe", name });
  }
  for (const name of discoverItemIconNames(raw)) {
    iconJobs.push({ key: `item/${name}`, cat: "item", name });
  }
  for (const category of [
    "fluid",
    "virtual-signal",
    "quality",
    "space-location",
    "asteroid-chunk",
  ] as const) {
    for (const name of Object.keys(raw[category] ?? {}).sort()) {
      iconJobs.push({ key: `${category}/${name}`, cat: category, name });
    }
  }

  const utility = raw["utility-sprites"]?.default as Record<string, RawSprite> | undefined;
  for (const [key, field] of [
    ["utility/entity-info-dark-background", "entity_info_dark_background"],
    ["utility/missing-icon", "missing_icon"],
    ["utility/filter-blacklist", "filter_blacklist"],
    ["utility/indication-arrow", "indication_arrow"],
  ] as const) {
    const sprite = utility?.[field];
    if (!sprite) continue;
    try {
      icons[key] = (await bank.addSprite(sprite)).frameId;
      if (typeof sprite.scale === "number" && Number.isFinite(sprite.scale)) {
        iconScales[key] = sprite.scale;
      }
    } catch (err) {
      console.log(`  icon ${key} MISSING (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Item-request pin chrome (modules/fuel to insert). Not in utility-sprites; it is
  // the item-request-proxy icon mip sheet — crop the first 64×64 mip only.
  try {
    icons["utility/item-request-slot"] = (
      await bank.addSprite({
        filename: "__core__/graphics/icons/mip/item-request-slot.png",
        size: 64,
      })
    ).frameId;
    console.log("  icon utility/item-request-slot ok");
  } catch (err) {
    console.log(
      `  icon utility/item-request-slot MISSING (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  try {
    const crop = await cropEntireFile(UNSUPPORTED_ENTITY_PNG);
    icons["utility/unsupported-entity"] = await bank.add(crop);
    console.log("  icon utility/unsupported-entity ok (fpsr asset)");
  } catch (err) {
    console.log(
      `  icon utility/unsupported-entity MISSING (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  for (const job of iconJobs) {
    if (icons[job.key] != null) continue;
    process.stdout.write(`  icon ${job.key}…`);
    const id = await distillIcon(bank, raw, job.cat, job.name, job.type);
    if (id != null) {
      icons[job.key] = id;
      if (job.cat === "entity") {
        const ent = entities[job.name];
        if (ent) ent.icon = id;
      }
      console.log(" ok");
    } else {
      console.log(" MISSING");
    }
  }

  await mkdir(paths.assetsOut, { recursive: true });
  const staging = await mkdtemp(path.join(paths.assetsOut, `.tmp-${paths.install.version}-`));
  console.log("pack: deriving 1x frames…");
  const oneXFrames = await scaleRegisteredFrames(bank.list(), 0.5);
  const tierDefinitions = () => ({
    entities: structuredClone(entities),
    tiles: structuredClone(tiles),
    icons: structuredClone(icons),
  });

  console.log("pack: packing 1x atlases…");
  const oneXDefinitions = tierDefinitions();
  const packed1x = await packAtlases(oneXFrames, oneXDefinitions, staging, {
    format: "webp",
  }).catch(async (error) => {
    await rm(staging, { recursive: true, force: true });
    throw error;
  });

  console.log("pack: packing 2x atlases…");
  const twoXDefinitions = tierDefinitions();
  const packed2x = await packAtlases(bank.list(), twoXDefinitions, staging, {
    format: "webp",
  }).catch(async (error) => {
    await rm(staging, { recursive: true, force: true });
    throw error;
  });

  const persistTier = async (
    density: 1 | 2,
    packed: typeof packed2x,
    definitions: ReturnType<typeof tierDefinitions>,
  ) => {
    const db: RenderDb = {
      schema: 2,
      gameVersion: paths.install.version,
      mods: [...paths.mods],
      assetDensity: density,
      atlases: packed.atlases,
      frames: packed.frames,
      ...definitions,
      ...(Object.keys(iconScales).length > 0 ? { iconScales } : {}),
    };
    const dbJson = `${JSON.stringify(db)}\n`;
    const sha256 = createHash("sha256").update(dbJson).digest("hex");
    const file = `render-db.${sha256}.json`;
    await writeFile(path.join(staging, file), dbJson);
    return {
      db,
      manifest: {
        density,
        renderDb: { file, sha256, bytes: Buffer.byteLength(dbJson) },
        atlases: packed.manifestAtlases.map((atlas) => ({
          file: atlas.file,
          w: atlas.width,
          h: atlas.height,
          sha256: atlas.sha256,
          bytes: atlas.bytes,
        })),
      },
    };
  };

  const oneX = await persistTier(1, packed1x, oneXDefinitions);
  const twoX = await persistTier(2, packed2x, twoXDefinitions);
  const manifest = {
    schema: 2,
    gameVersion: paths.install.version,
    mods: [...paths.mods],
    tiers: { "1x": oneX.manifest, "2x": twoX.manifest },
  };
  await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const kindCounts: Record<string, number> = {};
  for (const e of Object.values(entities)) {
    kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
  }
  const report: DistillReport = {
    placeholders,
    entityCount: Object.keys(entities).length,
    tileCount: Object.keys(tiles).length,
    kindCounts,
    packing: {
      sourceFrames: packed2x.stats.sourceFrames,
      packedFrames: packed2x.stats.packedFrames,
      sourcePixels: packed2x.stats.sourcePixels,
      packedPixels: packed2x.stats.packedPixels,
      clonedPixelRatio: packed2x.stats.clonedPixelRatio,
    },
    tierPacking: {
      "1x": {
        frames: packed1x.frames.length,
        atlases: packed1x.atlases.length,
        decodedPixels: packed1x.atlases.reduce((sum, atlas) => sum + atlas.width * atlas.height, 0),
        blobBytes: packed1x.manifestAtlases.reduce((sum, atlas) => sum + atlas.bytes, 0),
      },
      "2x": {
        frames: packed2x.frames.length,
        atlases: packed2x.atlases.length,
        decodedPixels: packed2x.atlases.reduce((sum, atlas) => sum + atlas.width * atlas.height, 0),
        blobBytes: packed2x.manifestAtlases.reduce((sum, atlas) => sum + atlas.bytes, 0),
      },
    },
  };
  await writeFile(
    path.join(staging, "distill-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  clearImageCache();

  const previousBytes = await directoryBytes(paths.versionOut);
  const generatedBytes = await directoryBytes(staging);
  if (
    !options.allowBundleGrowth &&
    previousBytes > 0 &&
    generatedBytes > previousBytes * MAX_BUNDLE_GROWTH_RATIO
  ) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(
      `Generated bundle ${(generatedBytes / 1024 / 1024).toFixed(2)} MiB exceeds ` +
        `${(MAX_BUNDLE_GROWTH_RATIO * 100).toFixed(0)}% of existing ` +
        `${(previousBytes / 1024 / 1024).toFixed(2)} MiB bundle. ` +
        `Re-run with --allow-bundle-growth if the increase is expected.`,
    );
  }
  await verifyAssetBundle(staging).catch(async (error) => {
    await rm(staging, { recursive: true, force: true });
    throw error;
  });
  await publishAtomic(staging, paths.versionOut);

  console.log(
    `distill: done — ${report.entityCount} entities, ${report.tileCount} tiles, ${Object.keys(icons).length} icons, ` +
      `1x ${packed1x.frames.length} frames/${packed1x.atlases.length} atlases, ` +
      `2x ${packed2x.frames.length} frames/${packed2x.atlases.length} atlases`,
  );
  if (placeholders.length > 0) {
    console.log(`distill: ${placeholders.length} placeholders:`);
    for (const ph of placeholders) console.log(`  - ${ph.name}: ${ph.reason}`);
  }
  console.log(`  kinds: ${JSON.stringify(kindCounts)}`);
  console.log(
    `  render DBs: 1x ${(oneX.manifest.renderDb.bytes / 1024).toFixed(1)} KB, ` +
      `2x ${(twoX.manifest.renderDb.bytes / 1024).toFixed(1)} KB`,
  );
  return twoX.db;
}
