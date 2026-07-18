import { dir16ToIndex } from "../resolve.js";
import { buildTrainChainGeometry } from "../train-chains.js";
import type { Blueprint, BlueprintEntity } from "../types/blueprint.js";
import {
  type DrawCmd,
  type DrawList,
  RENDER_LAYERS,
  type TrainChainCmd,
  type WireCmd,
} from "../types/draw-list.js";
import type { EntityRenderDef, WireAnchorMap } from "../types/render-db.js";
import { WIRE_CONNECTOR_ID, type WireColor, wireConnectorColor } from "../wire-connectors.js";
import { includeCmdBounds } from "./bounds.js";

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

export function emitWires(
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
export function emitTrainChains(
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
