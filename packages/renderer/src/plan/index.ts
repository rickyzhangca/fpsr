import { planAltModeCommands, planRequestPinCommands } from "../alt-mode.js";
import { emitCargoBayConnections } from "../cargo-bay-connections.js";
import { migrateTo2x } from "../migrate.js";
import { type PlanProfile, nowMs } from "../profile.js";
import {
  cardinalDirection,
  collectBeltReaderEntities,
  createResolveContext,
  resolveWithContext,
} from "../resolve.js";
import type { Blueprint, BlueprintEntity, Color } from "../types/blueprint.js";
import {
  type DrawCmd,
  type DrawList,
  RENDER_LAYERS,
  type RectCmd,
  type SpriteCmd,
  compareDrawCmd,
} from "../types/draw-list.js";
import type { EntityRenderDef, RenderDb, RenderLayerName } from "../types/render-db.js";
import { emitBeltReaders } from "./belt-readers.js";
import { includeCmdBounds, spriteDest, undergroundBeltUnderlayClip } from "./bounds.js";
import {
  buildBeltConnectorVariations,
  emitBeltCircuitConnectors,
  emitCircuitConnectors,
  emitCombinatorDisplay,
} from "./circuit-connectors.js";
import { emitPipeCovers } from "./pipe-covers.js";
import { planMaterialTileSprite, tileVariantHash } from "./tiles.js";
import { unsupportedEntityCommand } from "./unsupported.js";
import { emitTrainChains, emitWires } from "./wires.js";

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

export { undergroundBeltUnderlayClip } from "./bounds.js";
export { tileMod, tileVariantHash } from "./tiles.js";
export { UNSUPPORTED_ENTITY_ICON_KEY } from "./unsupported.js";

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
