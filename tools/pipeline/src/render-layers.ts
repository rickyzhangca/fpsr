/**
 * Render-layer resolution for distill.
 *
 * OFFICIAL = string from Factorio dump / API (`RenderLayer` enum).
 * GUESS / FPSR = our heuristic when the dump does not expose a layer.
 *
 * Enum order: https://lua-api.factorio.com/latest/types/RenderLayer.html
 */

import type { FactorioRenderLayerName, RenderLayerName } from "./types.js";

/** All Factorio `RenderLayer` names (2.1.9). */
export const OFFICIAL_RENDER_LAYER_NAMES: ReadonlySet<string> = new Set<string>([
  "zero",
  "background-transitions",
  "under-tiles",
  "decals",
  "above-tiles",
  "ground-layer-1",
  "ground-layer-2",
  "ground-layer-3",
  "ground-layer-4",
  "ground-layer-5",
  "lower-radius-visualization",
  "radius-visualization",
  "transport-belt-integration",
  "resource",
  "building-smoke",
  "rail-stone-path-lower",
  "rail-stone-path",
  "rail-tie",
  "decorative",
  "ground-patch",
  "ground-patch-higher",
  "ground-patch-higher2",
  "rail-chain-signal-metal",
  "rail-screw",
  "rail-metal",
  "remnants",
  "floor",
  "transport-belt",
  "transport-belt-endings",
  "floor-mechanics-under-corpse",
  "corpse",
  "floor-mechanics",
  "item",
  "transport-belt-reader",
  "lower-object",
  "transport-belt-circuit-connector",
  "lower-object-above-shadow",
  "lower-object-overlay",
  "object-under",
  "object",
  "cargo-hatch",
  "higher-object-under",
  "higher-object-above",
  "train-stop-top",
  "item-in-inserter-hand",
  "above-inserters",
  "wires",
  "under-elevated",
  "elevated-rail-stone-path-lower",
  "elevated-rail-stone-path",
  "elevated-rail-tie",
  "elevated-rail-screw",
  "elevated-rail-metal",
  "elevated-lower-object",
  "elevated-object",
  "elevated-higher-object",
  "fluid-visualization",
  "wires-above",
  "entity-info-icon",
  "entity-info-icon-above",
  "explosion",
  "projectile",
  "smoke",
  "air-object",
  "air-entity-info-icon",
  "light-effect",
  "selection-box",
  "higher-selection-box",
  "collision-selection-box",
  "arrow",
  "cursor",
]);

/** Parse a dump/API layer string; null if missing or not a known Factorio name. */
export function officialLayer(value: unknown): FactorioRenderLayerName | null {
  if (typeof value !== "string") return null;
  if (!OFFICIAL_RENDER_LAYER_NAMES.has(value)) return null;
  return value as FactorioRenderLayerName;
}

/**
 * GUESS: layer chosen by fpsr when the dump does not expose one.
 * Keep call sites explicit so grepping `guessedLayer` finds every heuristic.
 */
export function guessedLayer(layer: RenderLayerName, _reason: string): RenderLayerName {
  return layer;
}

/**
 * FPSR-only layer name (not in Factorio's RenderLayer enum), e.g. shadow pass.
 */
export function fpsrLayer(
  layer: Extract<
    RenderLayerName,
    | "shadow"
    | "ground-tile"
    | "tile-transition"
    | "water-tile"
    | "icons"
    | "rail-ties"
    | "elevated-rail-ties"
  >,
  _reason: string,
): RenderLayerName {
  return layer;
}

/**
 * Sheet piece name → key in `pictures.render_layers` (Factorio dump).
 * OFFICIAL map uses singular keys (`tie`, `screw`, `metal`, `stone_path_lower`).
 */
const RAIL_PIECE_TO_DUMP_KEY: Record<string, string> = {
  stone_path_background: "stone_path_lower",
  stone_path: "stone_path",
  ties: "tie",
  backplates: "screw",
  metals: "metal",
};

/**
 * Resolve rail piece layer from dump `pictures.render_layers` when present.
 * Falls back to GUESS only if the dump map is missing that piece.
 */
export function railPieceLayerFromDump(
  pictures: Record<string, unknown> | undefined,
  piece: string,
  elevated: boolean,
): { layer: RenderLayerName; source: "official" | "guess" } {
  const dumpKey = RAIL_PIECE_TO_DUMP_KEY[piece] ?? piece;
  const table = pictures?.render_layers;
  if (table && typeof table === "object" && !Array.isArray(table)) {
    const raw = (table as Record<string, unknown>)[dumpKey];
    const layer = officialLayer(raw);
    if (layer) return { layer, source: "official" };
  }

  // GUESS fallbacks when dump omits the piece (should be rare for stock rails).
  const guessGround: Record<string, RenderLayerName> = {
    stone_path_background: "rail-stone-path-lower",
    stone_path: "rail-stone-path",
    ties: "rail-tie",
    backplates: "rail-screw",
    metals: "rail-metal",
  };
  const guessElevated: Record<string, RenderLayerName> = {
    stone_path_background: "elevated-rail-stone-path-lower",
    stone_path: "elevated-rail-stone-path",
    ties: "elevated-rail-tie",
    backplates: "elevated-rail-screw",
    metals: "elevated-rail-metal",
  };
  const map = elevated ? guessElevated : guessGround;
  return {
    layer: guessedLayer(
      map[piece] ?? (elevated ? "elevated-object" : "object"),
      `rail piece ${piece} missing from dump render_layers`,
    ),
    source: "guess",
  };
}
