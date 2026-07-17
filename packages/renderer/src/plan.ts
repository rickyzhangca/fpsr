import { planAltModeCommands, planRequestPinCommands } from "./alt-mode.js";
import { emitCargoBayConnections } from "./cargo-bay-connections.js";
import { entityInfoSilhouettePadPx } from "./icon-silhouette.js";
import { migrateTo2x } from "./migrate.js";
import { type PlanProfile, nowMs } from "./profile.js";
import {
  type BeltOccupant,
  beltCircuitConnectorFrame,
  beltCircuitConnectorVariation,
  beltConnectorBackPatchIndex,
  beltReaderSlots,
  cardinalDirection,
  collectBeltReaderEntities,
  createResolveContext,
  dir16ToIndex,
  isBeltCircuitInputEnabled,
  isBeltCircuitOutputEnabled,
  resolveWithContext,
} from "./resolve.js";
import { TRAIN_CHAIN_JOINT_RADIUS, buildTrainChainGeometry } from "./train-chains.js";
import type { Blueprint, BlueprintEntity, Color } from "./types/blueprint.js";
import {
  type DrawCmd,
  type DrawList,
  RENDER_LAYERS,
  type RectCmd,
  type SpriteCmd,
  type TrainChainCmd,
  type WireCmd,
  compareDrawCmd,
} from "./types/draw-list.js";
import type {
  BeltConnectorGraphics,
  BeltReaderGraphics,
  CombinatorGraphics,
  EntityRenderDef,
  FrameMeta,
  PipeCoverGraphics,
  RenderDb,
  RenderLayerName,
  SpriteVariant,
  TileMaterialAtlas,
  WireAnchorMap,
  WireConnectorGraphics,
} from "./types/render-db.js";
import { WIRE_CONNECTOR_ID, type WireColor, wireConnectorColor } from "./wire-connectors.js";

/** Normalize blueprint/proto color to 0–1 RGBA (Factorio may export 0–255). */
export function normalizeEntityColor(color: Color): [number, number, number, number] {
  let r = color.r;
  let g = color.g;
  let b = color.b;
  let a = color.a ?? 1;
  if (r > 1 || g > 1 || b > 1 || a > 1) {
    r /= 255;
    g /= 255;
    b /= 255;
    if (a > 1) a /= 255;
  }
  return [r, g, b, a];
}

function isRuntimeColorMaskGroup(def: EntityRenderDef, groupIndex: number): boolean {
  const maskIndex = def.data?.colorMaskGroupIndex;
  const maskIndices = def.data?.colorMaskGroupIndices;
  return (
    (typeof maskIndex === "number" && groupIndex === maskIndex) ||
    (Array.isArray(maskIndices) && maskIndices.includes(groupIndex))
  );
}

function runtimeColorMaskTint(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  groupIndex: number,
): [number, number, number, number] | undefined {
  if (!isRuntimeColorMaskGroup(def, groupIndex)) return undefined;
  const fromEntity = entity.color;
  if (fromEntity) return normalizeEntityColor(fromEntity);
  const fallback = def.data?.defaultColor;
  if (Array.isArray(fallback) && fallback.length >= 3) {
    return [
      Number(fallback[0]) || 0,
      Number(fallback[1]) || 0,
      Number(fallback[2]) || 0,
      fallback[3] == null ? 1 : Number(fallback[3]) || 0,
    ];
  }
  // Factorio locomotive default when neither blueprint nor prototype color is present.
  if (def.kind === "train") return [242 / 255, 0, 0, 1];
  return undefined;
}

/** Tile-center key matching resolve.ts neighbor grid. */
function tileKey(x: number, y: number): string {
  return `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
}

function buildEntityGrid(entities: BlueprintEntity[]): Map<string, BlueprintEntity[]> {
  const grid = new Map<string, BlueprintEntity[]>();
  for (const e of entities) {
    const key = tileKey(e.position.x, e.position.y);
    const list = grid.get(key);
    if (list) list.push(e);
    else grid.set(key, [e]);
  }
  return grid;
}

/** direction4 index (N=0,E=1,S=2,W=3) from entity→pipe-tile offset. */
function coverDirIndex(ox: number, oy: number): 0 | 1 | 2 | 3 {
  if (Math.abs(ox) >= Math.abs(oy)) return ox > 0 ? 1 : 3;
  return oy > 0 ? 2 : 0;
}

/** True when the adjacent port tile has a pipe / pipe-to-ground / fluid entity. */
function fluidPortOccupied(
  grid: Map<string, BlueprintEntity[]>,
  db: RenderDb,
  pipeX: number,
  pipeY: number,
): boolean {
  const neighbors = grid.get(tileKey(pipeX, pipeY));
  if (!neighbors) return false;
  for (const n of neighbors) {
    const nd = db.entities[n.name];
    if (!nd) continue;
    if (nd.kind === "pipe") return true;
    if (nd.protoType === "pipe-to-ground" || n.name === "pipe-to-ground") return true;
    if (nd.data?.fluidConnections) return true;
  }
  return false;
}

function pushPipeCoverSprite(
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
  entity: BlueprintEntity,
  frame: FrameMeta,
  variant: SpriteVariant,
  cx: number,
  cy: number,
  sortY: number,
  sortX: number,
  sub: number,
): DrawList["bounds"] {
  const dest = spriteDest(cx, cy, frame, variant);
  // Unconnected caps sit on `object` (FBSR Layer.OBJECT at the adjacent tile).
  const layerName: RenderLayerName = variant.drawAsShadow ? "shadow" : "object";
  const cmd: SpriteCmd = {
    kind: "sprite",
    layer: RENDER_LAYERS[layerName],
    sortY: variant.drawAsShadow ? 0 : sortY,
    sortX: variant.drawAsShadow ? 0 : sortX,
    entity: entity.entity_number,
    sub,
    frame: variant.frame,
    x: dest.x,
    y: dest.y,
    w: dest.w,
    h: dest.h,
  };
  if (variant.drawAsShadow) cmd.shadow = true;
  commands.push(cmd);
  return includeCmdBounds(bounds, cmd, undefined, frame);
}

/**
 * Draw fluid-box pipe covers on each *unconnected* port's adjacent tile.
 * Factorio: `pipe_covers` are "the pictures to show when no FluidBox is
 * connected" — caps sealing open flanges (FBSR: `!isPipeConnected`).
 */
function emitPipeCovers(
  bp: Blueprint,
  db: RenderDb,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const grid = buildEntityGrid(bp.entities ?? []);
  let b = bounds;

  for (const { entity, def } of byNumber.values()) {
    // Pipes already draw their own joints; covers are for machine fluid-box flanges.
    if (def.kind === "pipe" || def.protoType === "pipe-to-ground") continue;
    const pc: PipeCoverGraphics | undefined = def.data?.pipeCovers;
    const fc = def.data?.fluidConnections;
    if (!pc?.covers || !fc) continue;

    const d = cardinalDirection(entity.direction ?? 0);
    // Match owning entity y-sort so covers composite with the machine cut.
    const sortY = entity.position.y + def.collisionBox[1][1];
    const sortX = entity.position.x;
    for (const [ox, oy] of fc[String(d)] ?? []) {
      const pipeX = entity.position.x + ox;
      const pipeY = entity.position.y + oy;
      // Cap only when nothing is connected on this port.
      if (fluidPortOccupied(grid, db, pipeX, pipeY)) continue;

      const di = coverDirIndex(ox, oy);
      const cover = pc.covers[di];
      if (!cover) continue;

      const shadow = pc.shadows?.[di];
      if (shadow) {
        const sf = db.frames[shadow.frame];
        if (sf) {
          b = pushPipeCoverSprite(commands, b, entity, sf, shadow, pipeX, pipeY, sortY, sortX, 80);
        }
      }
      const cf = db.frames[cover.frame];
      if (cf) {
        b = pushPipeCoverSprite(commands, b, entity, cf, cover, pipeX, pipeY, sortY, sortX, 81);
      }
    }
  }
  return b;
}

export interface PlanOptions {
  /** Emit blueprint-derived entity-info overlays (recipes, filters, signals, quality). */
  altMode?: boolean;
  /** Canvas clear color; not emitted into the draw list (backend concern). */
  background?: [number, number, number, number] | null;
  /**
   * Emit belt starting/ending cap sprites. Default true.
   * Caps use a full-tile shift behind/ahead of the belt (FBE-aligned).
   */
  beltEndings?: boolean;
  /**
   * When provided, filled with phase timings for this plan call.
   * Near-zero overhead when omitted.
   */
  profileOut?: PlanProfile;
}

const OBJECT_SORT_LAYERS: ReadonlySet<RenderLayerName> = new Set([
  "lower-object",
  "lower-object-above-shadow",
  "lower-object-overlay",
  "object-under",
  "object",
  "higher-object-under",
  "higher-object-above",
  "train-stop-top",
  "elevated-object",
]);

/** Render-db icon key for the fpsr-owned unsupported mod entity marker. */
export const UNSUPPORTED_ENTITY_ICON_KEY = "utility/unsupported-entity";

/** Default 1×1 footprint for entities absent from the render-db (mod content). */
const UNSUPPORTED_ENTITY_BOX: [[number, number], [number, number]] = [
  [-0.5, -0.5],
  [0.5, 0.5],
];

/** Orange fallback when the baked marker frame is unavailable (tests, stale db). */
const UNSUPPORTED_ENTITY_COLOR: [number, number, number, number] = [1, 0.55, 0, 1];

/** 64px marker art at proto scale 0.5 → 1 tile on map. */
const UNSUPPORTED_ENTITY_MARKER_SCALE = 0.5;

function unsupportedEntityRect(entity: BlueprintEntity): RectCmd {
  const [[x1, y1], [x2, y2]] = UNSUPPORTED_ENTITY_BOX;
  return {
    kind: "rect",
    layer: RENDER_LAYERS.object,
    sortY: entity.position.y + y2,
    sortX: entity.position.x,
    entity: entity.entity_number,
    sub: 0,
    x: entity.position.x + x1,
    y: entity.position.y + y1,
    w: x2 - x1,
    h: y2 - y1,
    color: UNSUPPORTED_ENTITY_COLOR,
  };
}

function unsupportedEntityCommand(entity: BlueprintEntity, db: RenderDb): DrawCmd {
  const frameId = db.icons[UNSUPPORTED_ENTITY_ICON_KEY];
  if (frameId != null) {
    const frame = db.frames[frameId];
    if (frame) {
      const variant: SpriteVariant = {
        frame: frameId,
        scale: UNSUPPORTED_ENTITY_MARKER_SCALE,
        shift: [0, 0],
      };
      const [, [, y2]] = UNSUPPORTED_ENTITY_BOX;
      const dest = spriteDest(entity.position.x, entity.position.y, frame, variant);
      return {
        kind: "sprite",
        layer: RENDER_LAYERS.object,
        sortY: entity.position.y + y2,
        sortX: entity.position.x,
        entity: entity.entity_number,
        sub: 0,
        frame: frameId,
        x: dest.x,
        y: dest.y,
        w: dest.w,
        h: dest.h,
      };
    }
  }
  return unsupportedEntityRect(entity);
}

/**
 * Deterministic integer hash of tile coordinates for picking among tile frame
 * variants. Stable across runs / platforms for the same (x, y).
 */
export function tileVariantHash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Positive modulo for tile grid coordinates (handles negatives). */
export function tileMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function materialVariantOrigin(
  variantIdx: number,
  material: TileMaterialAtlas,
): { x: number; y: number } {
  const patchPxW = material.patchW * material.tilePx;
  const patchPxH = material.patchH * material.tilePx;
  const lineLength = material.lineLength ?? 0;
  const sheetX = material.sheetX ?? 0;
  const sheetY = material.sheetY ?? 0;
  if (lineLength > 0) {
    return {
      x: sheetX + (variantIdx % lineLength) * patchPxW,
      y: sheetY + Math.floor(variantIdx / lineLength) * patchPxH,
    };
  }
  return { x: sheetX + variantIdx * patchPxW, y: sheetY };
}

function planMaterialTileSprite(
  tx: number,
  ty: number,
  material: TileMaterialAtlas,
  layer: number,
  frames: FrameMeta[],
): SpriteCmd | null {
  const { patchW, patchH, tilePx, count } = material;
  const bx = Math.floor(tx / patchW) * patchW;
  const by = Math.floor(ty / patchH) * patchH;
  const frameId = material.sheet;
  const frame = frames[frameId];
  if (!frame) return null;
  const variantIdx = tileVariantHash(bx, by) % count;
  const patchOrigin = materialVariantOrigin(variantIdx, material);
  const lx = tileMod(tx, patchW);
  const ly = tileMod(ty, patchH);
  return {
    kind: "sprite",
    layer,
    sortY: 0,
    sortX: 0,
    entity: 0,
    sub: 0,
    frame: frameId,
    x: tx,
    y: ty,
    w: 1,
    h: 1,
    src: {
      x: patchOrigin.x + lx * tilePx,
      y: patchOrigin.y + ly * tilePx,
      w: tilePx,
      h: tilePx,
    },
  };
}

function spriteDest(
  posX: number,
  posY: number,
  frame: FrameMeta,
  variant: SpriteVariant,
  extraShift?: [number, number],
): { x: number; y: number; w: number; h: number } {
  const w = (frame.sw * variant.scale) / 32;
  const h = (frame.sh * variant.scale * (variant.scaleY ?? 1)) / 32;
  const sx = extraShift?.[0] ?? 0;
  const sy = extraShift?.[1] ?? 0;
  const cx = posX + variant.shift[0] + sx;
  const cy = posY + variant.shift[1] + sy;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Open-side half of a UG/loader belt underlay (Factorio/FBE: only half the belt
 * shows under the hood). `openDir` is the direction toward the hood opening.
 */
export function undergroundBeltUnderlayClip(
  dest: { x: number; y: number; w: number; h: number },
  openDir: 0 | 4 | 8 | 12,
): { x: number; y: number; w: number; h: number } {
  switch (openDir) {
    case 4: // east half
      return { x: dest.x + dest.w / 2, y: dest.y, w: dest.w / 2, h: dest.h };
    case 12: // west half
      return { x: dest.x, y: dest.y, w: dest.w / 2, h: dest.h };
    case 8: // south half
      return { x: dest.x, y: dest.y + dest.h / 2, w: dest.w, h: dest.h / 2 };
    case 0: // north half
      return { x: dest.x, y: dest.y, w: dest.w, h: dest.h / 2 };
  }
}

function expandBounds(
  bounds: DrawList["bounds"] | null,
  x: number,
  y: number,
  w: number,
  h: number,
): DrawList["bounds"] {
  const minX = x;
  const minY = y;
  const maxX = x + w;
  const maxY = y + h;
  if (!bounds) {
    return { minX, minY, maxX, maxY };
  }
  return {
    minX: Math.min(bounds.minX, minX),
    minY: Math.min(bounds.minY, minY),
    maxX: Math.max(bounds.maxX, maxX),
    maxY: Math.max(bounds.maxY, maxY),
  };
}

function spriteVisibleBounds(
  cmd: SpriteCmd,
  frame: FrameMeta,
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (cmd.src) {
    return { x: cmd.x, y: cmd.y, w: cmd.w, h: cmd.h };
  }
  const scaleX = frame.sw === 0 ? 0 : cmd.w / frame.sw;
  const scaleY = frame.sh === 0 ? 0 : cmd.h / frame.sh;
  const cx = cmd.x + cmd.w / 2;
  const cy = cmd.y + cmd.h / 2;
  let left = cmd.x + frame.ox * scaleX;
  let top = cmd.y + frame.oy * scaleY;
  let right = left + frame.w * scaleX;
  let bottom = top + frame.h * scaleY;

  if (cmd.flipX) [left, right] = [2 * cx - right, 2 * cx - left];
  if (cmd.flipY) [top, bottom] = [2 * cy - bottom, 2 * cy - top];

  const rotation = cmd.rotation ?? 0;
  if (rotation % 360 !== 0) {
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const corners = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ] as const;
    const rotated = corners.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as const;
    });
    left = Math.min(...rotated.map(([x]) => x));
    top = Math.min(...rotated.map(([, y]) => y));
    right = Math.max(...rotated.map(([x]) => x));
    bottom = Math.max(...rotated.map(([, y]) => y));
  }

  if (cmd.clip) {
    left = Math.max(left, cmd.clip.x);
    top = Math.max(top, cmd.clip.y);
    right = Math.max(left, Math.min(right, cmd.clip.x + cmd.clip.w));
    bottom = Math.max(top, Math.min(bottom, cmd.clip.y + cmd.clip.h));
  }

  return { x: left, y: top, w: right - left, h: bottom - top };
}

function includeCmdBounds(
  bounds: DrawList["bounds"] | null,
  cmd: DrawCmd,
  frames?: FrameMeta[],
  frameOverride?: FrameMeta,
): DrawList["bounds"] {
  switch (cmd.kind) {
    case "sprite": {
      const frame = frameOverride ?? frames?.[cmd.frame];
      const visible = frame ? spriteVisibleBounds(cmd, frame) : cmd;
      return expandBounds(bounds, visible.x, visible.y, visible.w, visible.h);
    }
    case "rect": {
      return expandBounds(bounds, cmd.x, cmd.y, cmd.w, cmd.h);
    }
    case "icon": {
      const backing = cmd.backingFrame == null ? undefined : frames?.[cmd.backingFrame];
      const isRequestPin = cmd.backingStyle === "request-pin";
      // Entity-info: 53 px no-scale backing around a 32 px scale-1 icon, plus
      // silhouette pad. Request-pin: cmd.size is opaque chrome width.
      const backingBasePx = isRequestPin ? Math.max(1, (backing?.w ?? 48) * (44 / 48)) : 32;
      const backingScale = cmd.size / backingBasePx;
      const silhouettePad =
        !isRequestPin &&
        (cmd.backingFrame != null || cmd.backing === true || cmd.silhouette === true)
          ? (entityInfoSilhouettePadPx() / 32) * cmd.size
          : 0;
      const width = Math.max(cmd.size + 2 * silhouettePad, (backing?.sw ?? 0) * backingScale);
      const height = Math.max(cmd.size + 2 * silhouettePad, (backing?.sh ?? 0) * backingScale);
      return expandBounds(bounds, cmd.x - width / 2, cmd.y - height / 2, width, height);
    }
    case "wire": {
      const minX = Math.min(cmd.x1, cmd.x2);
      const minY = Math.min(cmd.y1, cmd.y2);
      const maxX = Math.max(cmd.x1, cmd.x2);
      const maxY = Math.max(cmd.y1, cmd.y2);
      const mx = (cmd.x1 + cmd.x2) / 2;
      const my = (cmd.y1 + cmd.y2) / 2;
      const dist = Math.hypot(cmd.x2 - cmd.x1, cmd.y2 - cmd.y1);
      const sagY = my + 0.15 * dist;
      return expandBounds(
        expandBounds(bounds, minX, minY, maxX - minX, maxY - minY),
        mx,
        sagY,
        0,
        0,
      );
    }
    case "train-chain": {
      let b = bounds;
      for (const s of cmd.segments) {
        const minX = Math.min(s.x1, s.x2);
        const minY = Math.min(s.y1, s.y2);
        const maxX = Math.max(s.x1, s.x2);
        const maxY = Math.max(s.y1, s.y2);
        b = expandBounds(b, minX, minY, maxX - minX, maxY - minY);
      }
      for (const j of cmd.joints) {
        b = expandBounds(
          b,
          j.x - TRAIN_CHAIN_JOINT_RADIUS,
          j.y - TRAIN_CHAIN_JOINT_RADIUS,
          TRAIN_CHAIN_JOINT_RADIUS * 2,
          TRAIN_CHAIN_JOINT_RADIUS * 2,
        );
      }
      return b ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
  }
}

function isDirection4AnchorMap(anchors: WireAnchorMap): boolean {
  const keys = Object.keys(anchors);
  return keys.length > 0 && keys.every((k) => k === "0" || k === "1" || k === "2" || k === "3");
}

function wireAnchorDirIndex(
  direction: number | undefined,
  anchors: WireAnchorMap | undefined,
): string {
  if (!anchors) return "0";
  // Prefer direction16 → direction4 (when 4-way map) → direction8 → direction4 → "0".
  // Poles key anchors "0".."3"; trying direction8 first mis-maps east (4) → key "2".
  const d = (((direction ?? 0) % 16) + 16) % 16;
  if (anchors[String(d)]) return String(d);
  const d4 = String(Math.floor(d / 4) % 4);
  if (isDirection4AnchorMap(anchors) && anchors[d4]) return d4;
  const d8 = String(dir16ToIndex(d, "direction8"));
  if (anchors[d8]) return d8;
  if (anchors[d4]) return d4;
  if (anchors["0"]) return "0";
  return Object.keys(anchors)[0] ?? "0";
}

/**
 * Pick wire endpoint. Combinator output connectors (3/4) and power-switch right
 * copper (6) use `data.wireAnchorsOutput` when present; otherwise `wireAnchors`.
 * Belts key anchors by circuit-connector topology (0–6); pass `beltVariation`.
 */
function wireEndpoint(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  color: WireColor,
  connectorId: number,
  direction?: number,
  beltVariation?: number,
): [number, number] {
  const useOutput =
    connectorId === WIRE_CONNECTOR_ID.combinator_output_red ||
    connectorId === WIRE_CONNECTOR_ID.combinator_output_green ||
    connectorId === WIRE_CONNECTOR_ID.power_switch_right_copper;
  const primary = useOutput ? def.data?.wireAnchorsOutput : def.data?.wireAnchors;
  const fallback = def.data?.wireAnchors;
  const anchors = primary && Object.keys(primary).length > 0 ? primary : fallback;
  const key =
    def.kind === "belt" && beltVariation !== undefined
      ? String(beltVariation)
      : wireAnchorDirIndex(direction ?? entity.direction, anchors);
  const set = anchors?.[key] ?? (def.kind === "belt" ? anchors?.["0"] : undefined);
  const offset = set?.[color] ?? set?.copper ?? ([0, -0.5] as [number, number]);
  return [entity.position.x + offset[0], entity.position.y + offset[1]];
}

function emitWires(
  bp: Blueprint,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  poleDirs: Map<number, number>,
  beltVariations: Map<number, number>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const wires = bp.wires;
  if (!wires?.length) return bounds;
  let b = bounds;
  let sub = 0;
  for (const w of wires) {
    if (!Array.isArray(w) || w.length < 4) continue;
    const [srcNum, srcConn, dstNum, dstConn] = w;
    const src = byNumber.get(srcNum);
    const dst = byNumber.get(dstNum);
    if (!src || !dst) continue; // missing entity — skip gracefully
    const color = wireConnectorColor(srcConn) ?? wireConnectorColor(dstConn);
    if (!color) continue;
    const srcDir =
      src.def.protoType === "electric-pole" ? poleDirs.get(srcNum) : src.entity.direction;
    const dstDir =
      dst.def.protoType === "electric-pole" ? poleDirs.get(dstNum) : dst.entity.direction;
    const [x1, y1] = wireEndpoint(
      src.entity,
      src.def,
      color,
      srcConn,
      srcDir,
      beltVariations.get(srcNum),
    );
    const [x2, y2] = wireEndpoint(
      dst.entity,
      dst.def,
      color,
      dstConn,
      dstDir,
      beltVariations.get(dstNum),
    );
    const cmd: WireCmd = {
      kind: "wire",
      layer: RENDER_LAYERS.wires,
      sortY: 0,
      sortX: 0,
      entity: srcNum,
      sub: sub++,
      wire: color,
      x1,
      y1,
      x2,
      y2,
    };
    commands.push(cmd);
    b = includeCmdBounds(b, cmd);
  }
  return b;
}

/** Emit neon-green joint chain overlay for coupled rolling stock. */
function emitTrainChains(
  bp: Blueprint,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const geom = buildTrainChainGeometry(bp, byNumber);
  if (!geom) return bounds;
  const cmd: TrainChainCmd = {
    kind: "train-chain",
    layer: RENDER_LAYERS["selection-box"],
    sortY: 0,
    sortX: 0,
    entity: 0,
    sub: 0,
    segments: geom.segments,
    joints: geom.joints,
  };
  commands.push(cmd);
  return includeCmdBounds(bounds, cmd);
}

/** Entities that appear in any `bp.wires` tuple (FBE generateConnector). */
function wiredEntityNumbers(bp: Blueprint): Set<number> {
  const out = new Set<number>();
  for (const w of bp.wires ?? []) {
    if (!Array.isArray(w) || w.length < 4) continue;
    out.add(w[0]);
    out.add(w[2]);
  }
  return out;
}

function combinatorDisplayKey(entity: BlueprintEntity, def: EntityRenderDef): string | undefined {
  const behavior = entity.control_behavior;
  if (!behavior) return undefined;
  if (def.protoType === "arithmetic-combinator") {
    const conditions = behavior.arithmetic_conditions as Record<string, unknown> | undefined;
    return typeof conditions?.operation === "string" ? conditions.operation : undefined;
  }
  if (def.protoType === "decider-combinator") {
    const conditions = behavior.decider_conditions as
      | { conditions?: Record<string, unknown>[] }
      | undefined;
    const comparator = conditions?.conditions?.[0]?.comparator;
    if (typeof comparator !== "string") return undefined;
    return { "!=": "≠", "<=": "≤", ">=": "≥" }[comparator] ?? comparator;
  }
  if (def.protoType === "selector-combinator") {
    if (behavior.operation === "select") return behavior.select_max === false ? "min" : "max";
    return typeof behavior.operation === "string" ? behavior.operation : undefined;
  }
  return undefined;
}

function emitCombinatorDisplay(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const key = combinatorDisplayKey(entity, def);
  const graphics: CombinatorGraphics | undefined = def.data?.combinatorGraphics;
  const variants = key ? graphics?.symbols?.[key] : undefined;
  if (!variants) return bounds;
  const variant = variants[dir16ToIndex(entity.direction ?? 0, "direction4")] ?? variants[0];
  if (!variant) return bounds;
  const frame = db.frames[variant.frame];
  if (!frame) return bounds;
  const dest = spriteDest(entity.position.x, entity.position.y, frame, variant);
  const cmd: SpriteCmd = {
    kind: "sprite",
    layer: RENDER_LAYERS["higher-object-above"],
    sortY: entity.position.y + def.collisionBox[1][1],
    sortX: entity.position.x,
    entity: entity.entity_number,
    sub: 90,
    frame: variant.frame,
    x: dest.x,
    y: dest.y,
    w: dest.w,
    h: dest.h,
  };
  commands.push(cmd);
  return includeCmdBounds(bounds, cmd, db.frames);
}

const CCM_DRAW_ORDER = [
  "connector_shadow",
  "connector_main",
  "wire_pins_shadow",
  "wire_pins",
  "led_blue_off",
] as const;

function connectorDirIndex(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  graphics: WireConnectorGraphics,
  poleDirs: Map<number, number>,
): number {
  const direction =
    def.protoType === "electric-pole"
      ? (poleDirs.get(entity.entity_number) ?? entity.direction ?? 0)
      : (entity.direction ?? 0);
  const indexing = graphics.indexing ?? "direction4";
  return dir16ToIndex(direction, indexing === "single" ? "direction4" : indexing);
}

/**
 * Emit circuit-connector decorations (CCM) for entities that have wire links.
 * Paint order matches FBE: shadow → main → pins → led_blue_off.
 */
function emitCircuitConnectors(
  bp: Blueprint,
  db: RenderDb,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  poleDirs: Map<number, number>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const wired = wiredEntityNumbers(bp);
  if (wired.size === 0) return bounds;
  let b = bounds;
  for (const entityNumber of wired) {
    const entry = byNumber.get(entityNumber);
    if (!entry) continue;
    const { entity, def } = entry;
    const graphics: WireConnectorGraphics | undefined = def.data?.wireConnectorGraphics;
    if (!graphics?.layers) continue;
    const index = connectorDirIndex(entity, def, graphics, poleDirs);
    const sortYObject = entity.position.y + def.collisionBox[1][1];
    const sortXObject = entity.position.x;
    let sub = 100; // after body graphics / alt icons
    for (const key of CCM_DRAW_ORDER) {
      // Logistic chests expose bare red/green wire pegs in-game. Their generic
      // connector base and status LED must not be painted over the chest body.
      if (
        def.protoType === "logistic-container" &&
        key !== "wire_pins" &&
        key !== "wire_pins_shadow"
      ) {
        continue;
      }
      const variants = graphics.layers[key];
      if (!variants) continue;
      const variant = variants[index] ?? variants[0];
      if (!variant) continue;
      const frame = db.frames[variant.frame];
      if (!frame) continue;
      const dest = spriteDest(entity.position.x, entity.position.y, frame, variant);
      const isShadow = key.endsWith("_shadow") || variant.drawAsShadow === true;
      const cmd: SpriteCmd = {
        kind: "sprite",
        layer: isShadow ? RENDER_LAYERS.shadow : RENDER_LAYERS["higher-object-above"],
        sortY: isShadow ? 0 : sortYObject,
        sortX: isShadow ? 0 : sortXObject,
        entity: entity.entity_number,
        sub: sub++,
        frame: variant.frame,
        x: dest.x,
        y: dest.y,
        w: dest.w,
        h: dest.h,
      };
      if (variant.tint) cmd.tint = variant.tint;
      if (isShadow) cmd.shadow = true;
      if (variant.flipX) cmd.flipX = true;
      if (variant.flipY) cmd.flipY = true;
      if (variant.rotation) cmd.rotation = variant.rotation;
      commands.push(cmd);
      b = includeCmdBounds(b, cmd, db.frames);
    }
  }
  return b;
}

/**
 * Emit transport-belt circuit connector cage + LEDs on
 * transport-belt-circuit-connector (35), above transport-belt (27).
 *
 * Paint: shadow → back_patch → main (cage+pegs) → H/V décor wires → LEDs.
 *
 * The four sheet frames encode behavior state (none/output/input/both), not
 * direction. Décor plates reconstruct the selected source frame after distill
 * split its baked coils from the clean cage. LEDs use the same behavior state
 * (output → red/green; input → blue).
 */
function emitBeltCircuitConnectors(
  bp: Blueprint,
  db: RenderDb,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  beltVariations: Map<number, number>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  const wired = wiredEntityNumbers(bp);
  if (wired.size === 0) return bounds;
  let b = bounds;
  const layer = RENDER_LAYERS["transport-belt-circuit-connector"];

  for (const entityNumber of wired) {
    const entry = byNumber.get(entityNumber);
    if (!entry || entry.def.kind !== "belt") continue;
    const { entity, def } = entry;
    const graphics: BeltConnectorGraphics | undefined = def.data?.beltConnectorGraphics;
    if (!graphics?.layers) continue;

    const variation = beltVariations.get(entityNumber) ?? 0;
    const connectorFrame = beltCircuitConnectorFrame(entity);
    let sub = 50;
    const outputOn = isBeltCircuitOutputEnabled(entity);
    const inputOn = isBeltCircuitInputEnabled(entity);

    const pushVariant = (variant: SpriteVariant | null | undefined): void => {
      if (!variant) return;
      const frame = db.frames[variant.frame];
      if (!frame) return;
      const dest = spriteDest(entity.position.x, entity.position.y, frame, variant);
      const isShadow = variant.drawAsShadow === true;
      // Same layer as the cage; sub order keeps shadow under main/LEDs.
      const cmd: SpriteCmd = {
        kind: "sprite",
        layer,
        sortY: 0,
        sortX: 0,
        entity: entity.entity_number,
        sub: sub++,
        frame: variant.frame,
        x: dest.x,
        y: dest.y,
        w: dest.w,
        h: dest.h,
      };
      if (variant.tint) cmd.tint = variant.tint;
      if (isShadow) cmd.shadow = true;
      if (variant.flipX) cmd.flipX = true;
      if (variant.flipY) cmd.flipY = true;
      if (variant.rotation) cmd.rotation = variant.rotation;
      commands.push(cmd);
      b = includeCmdBounds(b, cmd, db.frames);
    };

    const shadowRow = graphics.layers.frame_shadow?.[variation];
    pushVariant(shadowRow?.[connectorFrame] ?? shadowRow?.[0]);

    const backPatch = graphics.layers.frame_back_patch;
    if (backPatch) {
      pushVariant(backPatch[beltConnectorBackPatchIndex(variation)] ?? backPatch[0]);
    }

    const mainRow = graphics.layers.frame_main?.[variation];
    pushVariant(mainRow?.[connectorFrame] ?? mainRow?.[0]);

    // Re-apply every décor plate present in the selected behavior-state frame.
    const hRow = graphics.layers.wire_horizontal?.[variation];
    const vRow = graphics.layers.wire_vertical?.[variation];
    pushVariant(hRow?.[connectorFrame] ?? hRow?.[0]);
    pushVariant(vRow?.[connectorFrame] ?? vRow?.[0]);

    const ledKeys: ("led_red" | "led_green" | "led_blue")[] = [];
    if (outputOn) ledKeys.push("led_red", "led_green");
    if (inputOn) ledKeys.push("led_blue");
    for (const ledKey of ledKeys) {
      const leds = graphics.layers[ledKey];
      if (!leds) continue;
      pushVariant(leds[variation] ?? leds[0]);
    }
  }
  return b;
}

function buildBeltConnectorVariations(
  bp: Blueprint,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  beltIndex: Map<string, BeltOccupant[]>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const entityNumber of wiredEntityNumbers(bp)) {
    const entry = byNumber.get(entityNumber);
    if (!entry || entry.def.kind !== "belt") continue;
    out.set(entityNumber, beltCircuitConnectorVariation(entry.entity, beltIndex));
  }
  return out;
}

/** Official belt_reader layers (already above transport-belt in Factorio enum). */
function paintBeltReaderLayer(official: RenderLayerName): number {
  return RENDER_LAYERS[official] ?? RENDER_LAYERS["transport-belt-reader"];
}

function beltReaderLayerOrder(name: RenderLayerName): number {
  return RENDER_LAYERS[name] ?? 0;
}

/**
 * Emit whole-belt-reader side skirts for entire_belt_hold lines.
 * Sheet is band×NESW; each belt may paint multiple edge frames.
 * Underground belts on the line get skirts too (under the hood).
 */
function emitBeltReaders(
  bp: Blueprint,
  db: RenderDb,
  byNumber: Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>,
  beltIndex: Map<string, BeltOccupant[]>,
  readerEntities: Set<number>,
  commands: DrawCmd[],
  bounds: DrawList["bounds"] | null,
): DrawList["bounds"] | null {
  if (readerEntities.size === 0) return bounds;
  let b = bounds;

  for (const entityNumber of readerEntities) {
    const entry = byNumber.get(entityNumber);
    if (!entry) continue;
    const { entity, def } = entry;
    if (def.kind !== "belt" && def.kind !== "underground-belt") continue;
    const graphics: BeltReaderGraphics | undefined = def.data?.beltReaderGraphics;
    if (!graphics?.layers?.length) continue;

    const slots = beltReaderSlots(entity, def, beltIndex, readerEntities);
    // Official order: endings < floor-mechanics < transport-belt-reader < object.
    // Skirts stay under UG hoods (object) so they appear to run through — same as in-game.
    const layers = [...graphics.layers].sort(
      (a, b) => beltReaderLayerOrder(a.layer) - beltReaderLayerOrder(b.layer),
    );

    // Per-entity sub (not global): sort is (layer, sortY, sortX, entity, sub), and belt
    // cages use sub≥50 on transport-belt-circuit-connector. A global counter
    // pushed later reader entities above 50 so skirts painted over cages.
    let sub = 10;

    for (const slot of slots) {
      for (const layer of layers) {
        const variant = layer.variants[slot.band]?.[slot.frame];
        if (!variant) continue;
        const frame = db.frames[variant.frame];
        if (!frame) continue;
        const dest = spriteDest(entity.position.x, entity.position.y, frame, variant, slot.shift);
        const isShadow = variant.drawAsShadow === true;
        const cmd: SpriteCmd = {
          kind: "sprite",
          layer: isShadow ? RENDER_LAYERS.shadow : paintBeltReaderLayer(layer.layer),
          sortY: 0,
          sortX: 0,
          entity: entity.entity_number,
          sub: sub++,
          frame: variant.frame,
          x: dest.x,
          y: dest.y,
          w: dest.w,
          h: dest.h,
        };
        if (variant.tint) cmd.tint = variant.tint;
        if (isShadow) cmd.shadow = true;
        // Slot flip (ending mirror) XOR variant flip from distill.
        if (Boolean(variant.flipX) !== Boolean(slot.flipX)) cmd.flipX = true;
        if (Boolean(variant.flipY) !== Boolean(slot.flipY)) cmd.flipY = true;
        if (variant.rotation) cmd.rotation = variant.rotation;
        commands.push(cmd);
        b = includeCmdBounds(b, cmd, db.frames);
      }
    }
  }
  return b;
}

/**
 * Pure draw planner: blueprint + render-db -> sorted DrawList.
 */
export function planDrawList(bp: Blueprint, db: RenderDb, opts?: PlanOptions): DrawList {
  const altMode = opts?.altMode ?? true;
  const beltEndings = opts?.beltEndings ?? true;
  const profile = opts?.profileOut;
  const tTotal = profile ? nowMs() : 0;

  let t = profile ? nowMs() : 0;
  bp = migrateTo2x(bp);
  if (profile) profile.migrateMs = nowMs() - t;

  const commands: DrawCmd[] = [];
  let bounds: DrawList["bounds"] | null = null;

  // --- tiles ---
  t = profile ? nowMs() : 0;
  for (const tile of bp.tiles ?? []) {
    const def = db.tiles[tile.name];
    if (!def) continue;
    const layer = RENDER_LAYERS[def.layer];
    const tx = tile.position.x;
    const ty = tile.position.y;

    if (def.material && def.material.count > 0) {
      const cmd = planMaterialTileSprite(tx, ty, def.material, layer, db.frames);
      if (!cmd) continue;
      commands.push(cmd);
      bounds = includeCmdBounds(bounds, cmd, db.frames);
    } else if (def.frames && def.frames.length > 0) {
      const frameId = def.frames[tileVariantHash(tx, ty) % def.frames.length];
      if (frameId === undefined) continue;
      const frame = db.frames[frameId];
      if (!frame) continue;
      const cmd: SpriteCmd = {
        kind: "sprite",
        layer,
        sortY: 0,
        sortX: 0,
        entity: 0,
        sub: 0,
        frame: frameId,
        x: tx,
        y: ty,
        w: 1,
        h: 1,
      };
      commands.push(cmd);
      bounds = includeCmdBounds(bounds, cmd, db.frames);
    } else {
      const cmd: RectCmd = {
        kind: "rect",
        layer,
        sortY: 0,
        sortX: 0,
        entity: 0,
        sub: 0,
        x: tx,
        y: ty,
        w: 1,
        h: 1,
        color: def.color,
      };
      commands.push(cmd);
      bounds = includeCmdBounds(bounds, cmd);
    }
  }
  if (profile) profile.tilesMs = nowMs() - t;

  // --- entities ---
  t = profile ? nowMs() : 0;
  for (const entity of bp.entities ?? []) {
    if (db.entities[entity.name]) continue;
    const cmd = unsupportedEntityCommand(entity, db);
    commands.push(cmd);
    bounds = includeCmdBounds(bounds, cmd, db.frames);
  }

  const tResolve = profile ? nowMs() : 0;
  const resolveContext = createResolveContext(bp, db);
  const resolved = resolveWithContext(resolveContext, undefined, { beltEndings });
  if (profile) profile.resolveMs = nowMs() - tResolve;

  const byNumber = new Map<number, { entity: BlueprintEntity; def: EntityRenderDef }>();
  for (const { entity, def, selections } of resolved) {
    byNumber.set(entity.entity_number, { entity, def });
    // Rolling stock collision boxes are elongated along the track; using the
    // south edge makes a horizontal loco sort past trackside entities (e.g. a
    // train-stop to the south). Factorio sorts rolling stock by position.y.
    const sortYObject =
      def.kind === "train" ? entity.position.y : entity.position.y + def.collisionBox[1][1];
    const sortXObject = entity.position.x;

    for (const sel of selections) {
      const group = def.graphics[sel.group];
      if (!group) continue;
      // A zero runtime color is Factorio's sentinel for an unpainted vehicle;
      // do not draw its apply_runtime_tint mask until the blueprint/prototype
      // supplies an actual color.
      if (
        def.kind === "vehicle" &&
        isRuntimeColorMaskGroup(def, sel.group) &&
        !entity.color &&
        !Array.isArray(def.data?.defaultColor)
      ) {
        continue;
      }
      const variants = group.variants[sel.variantKey] ?? group.variants.default;
      if (!variants) continue;
      const variant = variants[sel.index];
      if (!variant) continue;

      const frame = db.frames[variant.frame];
      if (!frame) continue;

      const dest = spriteDest(entity.position.x, entity.position.y, frame, variant, sel.shift);
      const layerName = group.layer;
      const isObjectLayer = OBJECT_SORT_LAYERS.has(layerName);
      const cmd: SpriteCmd = {
        kind: "sprite",
        layer: RENDER_LAYERS[layerName],
        sortY: isObjectLayer ? sortYObject : 0,
        sortX: isObjectLayer ? sortXObject : 0,
        entity: entity.entity_number,
        sub: sel.group,
        frame: variant.frame,
        x: dest.x,
        y: dest.y,
        w: dest.w,
        h: dest.h,
      };
      if (variant.tint) cmd.tint = variant.tint;
      const maskTint = runtimeColorMaskTint(entity, def, sel.group);
      if (maskTint) cmd.tint = maskTint;
      if (variant.drawAsShadow) cmd.shadow = true;
      if (variant.flipX) cmd.flipX = true;
      if (variant.flipY) cmd.flipY = true;
      if (variant.rotation != null && variant.rotation !== 0) cmd.rotation = variant.rotation;

      // UG/loader belt underlay: clip straight to open-side half (caps stay full).
      if (
        (def.kind === "underground-belt" || def.kind === "loader") &&
        group.layer === "transport-belt" &&
        sel.variantKey !== "start" &&
        sel.variantKey !== "end"
      ) {
        const facing = cardinalDirection(entity.direction ?? 0);
        const openDir = entity.type === "output" ? facing : (((facing + 8) % 16) as 0 | 4 | 8 | 12);
        cmd.clip = undergroundBeltUnderlayClip(dest, openDir);
      }
      commands.push(cmd);
      bounds = includeCmdBounds(bounds, cmd, db.frames);
    }

    bounds = emitCombinatorDisplay(entity, def, db, commands, bounds);

    // Request pins are always shown; alt mode only adds entity-info overlays.
    const requestPins = planRequestPinCommands(entity, def, db);
    for (const cmd of requestPins) {
      commands.push(cmd);
      bounds = includeCmdBounds(bounds, cmd, db.frames);
    }
    if (altMode) {
      for (const cmd of planAltModeCommands(entity, def, db, {
        insertCommands: requestPins,
      })) {
        commands.push(cmd);
        bounds = includeCmdBounds(bounds, cmd, db.frames);
      }
    }
  }
  if (profile) {
    // Exclude resolve from entitiesMs so phases are additive.
    profile.entitiesMs = nowMs() - t - profile.resolveMs;
  }

  t = profile ? nowMs() : 0;
  const { beltIndex, poleDirs } = resolveContext;
  const beltVariations = buildBeltConnectorVariations(bp, byNumber, beltIndex);
  const readerEntities = collectBeltReaderEntities(bp, db, beltIndex);
  bounds = emitCircuitConnectors(bp, db, byNumber, poleDirs, commands, bounds);
  bounds = emitBeltReaders(bp, db, byNumber, beltIndex, readerEntities, commands, bounds);
  bounds = emitBeltCircuitConnectors(bp, db, byNumber, beltVariations, commands, bounds);
  bounds = emitPipeCovers(bp, db, byNumber, commands, bounds);
  bounds = emitWires(bp, byNumber, poleDirs, beltVariations, commands, bounds);
  bounds = emitTrainChains(bp, byNumber, commands, bounds);
  const commandsBeforeConnections = commands.length;
  emitCargoBayConnections(bp, db, resolveContext.preferPlatformGraphics, commands);
  for (let i = commandsBeforeConnections; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd) bounds = includeCmdBounds(bounds, cmd, db.frames);
  }
  if (profile) profile.overlaysMs = nowMs() - t;

  t = profile ? nowMs() : 0;
  commands.sort(compareDrawCmd);
  if (profile) {
    profile.sortMs = nowMs() - t;
    profile.totalMs = nowMs() - tTotal;
  }

  if (commands.length === 0) {
    return {
      schema: 1,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      commands: [],
    };
  }

  return {
    schema: 1,
    bounds: bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    commands,
  };
}
