import {
  type BeltOccupant,
  beltCircuitConnectorFrame,
  beltCircuitConnectorVariation,
  beltConnectorBackPatchIndex,
  dir16ToIndex,
  isBeltCircuitInputEnabled,
  isBeltCircuitOutputEnabled,
} from "../resolve.js";
import type { Blueprint, BlueprintEntity } from "../types/blueprint.js";
import { type DrawCmd, type DrawList, RENDER_LAYERS, type SpriteCmd } from "../types/draw-list.js";
import type {
  BeltConnectorGraphics,
  CombinatorGraphics,
  EntityRenderDef,
  RenderDb,
  SpriteVariant,
  WireConnectorGraphics,
} from "../types/render-db.js";
import { includeCmdBounds, spriteDest } from "./bounds.js";

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
      | { conditions?: Record<string, unknown>[]; comparator?: unknown }
      | undefined;
    // 2.x nests conditions; 1.x keeps comparator on the root object.
    const nested = conditions?.conditions?.[0]?.comparator;
    const flat = conditions?.comparator;
    const comparator =
      typeof nested === "string" ? nested : typeof flat === "string" ? flat : undefined;
    if (typeof comparator !== "string") return undefined;
    return { "!=": "≠", "<=": "≤", ">=": "≥" }[comparator] ?? comparator;
  }
  if (def.protoType === "selector-combinator") {
    if (behavior.operation === "select") return behavior.select_max === false ? "min" : "max";
    return typeof behavior.operation === "string" ? behavior.operation : undefined;
  }
  return undefined;
}

export function emitCombinatorDisplay(
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
export function emitCircuitConnectors(
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
export function emitBeltCircuitConnectors(
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

export function buildBeltConnectorVariations(
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
