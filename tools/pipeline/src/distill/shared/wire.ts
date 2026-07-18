import { leafLayers, round4, type FrameBank } from "../../sprite.js";
import type {
  EntityRenderData,
  EntityRenderDef,
  RawSprite,
  SpriteVariant,
  WireAnchorSet,
  WireConnectorGraphics,
} from "../../types.js";

export type WireAnchorPoint = WireAnchorSet;

export function readWirePoint(
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

export function anchorsFromWireObj(
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

export function anchorsFromConnectionPoints(
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
export function computeWireAnchors(p: Record<string, unknown>): Record<string, WireAnchorPoint> {
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

export function computeWireAnchorsOutput(
  p: Record<string, unknown>,
): Record<string, WireAnchorPoint> {
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

export function withWireAnchors(def: EntityRenderDef, p: Record<string, unknown>): EntityRenderDef {
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
  const data: EntityRenderData = { ...def.data };
  if (Object.keys(wireAnchors).length > 0) data.wireAnchors = wireAnchors;
  if (Object.keys(wireAnchorsOutput).length > 0) data.wireAnchorsOutput = wireAnchorsOutput;
  if (!data.wireAnchors && !data.wireAnchorsOutput) return def;
  return { ...def, data };
}

/** CCM sprite keys we distill (FBE draws main + pins + led_blue_off; shadows for depth). */
export const CCM_SPRITE_KEYS = [
  "connector_shadow",
  "connector_main",
  "wire_pins_shadow",
  "wire_pins",
  "led_blue_off",
] as const;

export type CcmSpriteKey = (typeof CCM_SPRITE_KEYS)[number];

export type CircuitConnectorEntry = {
  sprites?: Partial<Record<CcmSpriteKey, RawSprite>>;
  points?: { wire?: Record<string, unknown> };
};

export function resolveCircuitConnectorList(
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
export async function distillCircuitConnectorGraphics(
  bank: FrameBank,
  p: Record<string, unknown>,
): Promise<WireConnectorGraphics | undefined> {
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

export async function withCircuitConnectorGraphics(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  const graphics = await distillCircuitConnectorGraphics(bank, p);
  if (!graphics) return def;
  return { ...def, data: { ...def.data, wireConnectorGraphics: graphics } };
}
