import type { BlueprintEntity } from "./types/blueprint.js";
import { RENDER_LAYERS, type IconCmd } from "./types/draw-list.js";
import type { EntityRenderDef, RenderDb } from "./types/render-db.js";
import { type AltSignal, asSignal, entitySignals, resolveAltSignals } from "./alt-mode-signals.js";

const MAX_INSERT_PLAN_ICONS = 16;

export function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Expand insert plans into their actual inventory-slot order and multiplicity. */
export function insertPlanSignals(items: BlueprintEntity["items"]): AltSignal[] {
  if (!Array.isArray(items)) return [];
  const slotted: {
    signal: AltSignal;
    inventory: number;
    stack: number;
    order: number;
  }[] = [];
  const fallback: { signal: AltSignal; order: number }[] = [];
  let order = 0;

  for (const item of items) {
    const signal = asSignal(item.id);
    if (!signal) continue;
    const positions = Array.isArray(item.items?.in_inventory) ? item.items.in_inventory : [];
    if (positions.length > 0) {
      for (const position of positions) {
        const count = Math.min(positiveInteger(position.count, 1), MAX_INSERT_PLAN_ICONS);
        for (let i = 0; i < count; i++) {
          slotted.push({
            signal: { ...signal },
            inventory: Number.isFinite(position.inventory)
              ? position.inventory
              : Number.MAX_SAFE_INTEGER,
            stack: Number.isFinite(position.stack) ? position.stack : Number.MAX_SAFE_INTEGER,
            order: order++,
          });
        }
      }
      continue;
    }

    // `grid_count` is the 2.x equipment-grid shape and is also used by the 1.x
    // items-object migration. Preserve it as a compatibility fallback.
    const gridCount = positiveInteger(item.items?.grid_count, 0);
    const count = Math.min(gridCount > 0 ? gridCount : 1, MAX_INSERT_PLAN_ICONS);
    for (let i = 0; i < count; i++) fallback.push({ signal: { ...signal }, order: order++ });
  }

  slotted.sort((a, b) => a.inventory - b.inventory || a.stack - b.stack || a.order - b.order);
  return [...slotted.map((entry) => entry.signal), ...fallback.map((entry) => entry.signal)].slice(
    0,
    MAX_INSERT_PLAN_ICONS,
  );
}

/** Extra gap between recipe and module rows on assemblers (tiles). */
const ASSEMBLER_INSERT_PLAN_Y_OFFSET = 0.2;
/**
 * Visible request-pin size in tiles (36 px at the viewer’s default 64 ppt).
 */
const INSERT_PLAN_ICON_SCALE = 36 / 64;
/** Edge-to-edge gap between visible pin chrome (~2 px at 64 ppt). */
const INSERT_PLAN_GAP_TILES = 2 / 64;

export function insertPlanLayout(count: number): { scale: number; xOffsets: number[] } {
  if (count <= 0) return { scale: 0, xOffsets: [] };
  const scale = INSERT_PLAN_ICON_SCALE;
  const step = scale + INSERT_PLAN_GAP_TILES;
  return {
    scale,
    xOffsets: Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * step),
  };
}

/**
 * Opaque pin height ÷ width from `item-request-slot` (a>20 bbox ≈ 44×62).
 * Used when estimating pin vertical extent for rolling-stock placement.
 */
const REQUEST_PIN_HEIGHT_OVER_WIDTH = 62 / 44;

/**
 * Rolling-stock request-pin Y offset from entity center.
 *
 * Note: locomotive `icons_positioning.shift[1] = 0.3` and the IconSequencePositioning
 * default `0.7` are for inventory/burner alt-info, not item-request pins — using
 * those overshot. Empirically pins sit about half a pin-height below center.
 */
export function trainInsertPlanShiftY(pinSize: number): number {
  return (pinSize * REQUEST_PIN_HEIGHT_OVER_WIDTH) / 2;
}

export function iconLayout(count: number, scale: number): [number, number][] {
  if (count <= 1) return [[0, 0]];
  if (count === 2)
    return [
      [-scale * 0.3, 0],
      [scale * 0.3, 0],
    ];
  const cols = Math.min(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const spacing = scale * 0.62;
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push([(col - (cols - 1) / 2) * spacing, (row - (rows - 1) / 2) * spacing]);
  }
  return out;
}

export function iconDrawSpec(def: EntityRenderDef) {
  return (
    def.iconDrawSpecification ?? {
      shift: [0, 0] as [number, number],
      scale: def.kind === "inserter" ? 0.5 : 0.75,
      scaleForMany: 0.5,
      renderLayer: "entity-info-icon" as const,
    }
  );
}

/**
 * Build insert-plan request-pin icons (sub 20–49). Always shown, not gated by alt mode.
 * Y matches the Factorio layout used when recipe/primary icons are present: pins sit
 * below those icons when the entity has primary signals, otherwise at the entity anchor.
 */
export function planRequestPinCommands(
  entity: BlueprintEntity,
  def: EntityRenderDef,
  db: RenderDb,
): IconCmd[] {
  const insertPlans = resolveAltSignals(db, insertPlanSignals(entity.items));
  if (insertPlans.length === 0) return [];

  const spec = iconDrawSpec(def);
  const pinBackingFrame = db.icons["utility/item-request-slot"];
  const darkBackingFrame = db.icons["utility/entity-info-dark-background"];
  const useRequestPin = pinBackingFrame !== undefined;
  const layer = RENDER_LAYERS[spec.renderLayer];
  const insertLayout = insertPlanLayout(insertPlans.length);

  // Rolling stock: request pins hang below entity center by ~half pin height.
  // Do not reuse icon_draw_specification (cargo badge) or icons_positioning
  // (burner alt-info) — those are different overlays.
  const insertAnchorY =
    def.kind === "train"
      ? entity.position.y + trainInsertPlanShiftY(insertLayout.scale)
      : entity.position.y + spec.shift[1];

  const primary = resolveAltSignals(db, entitySignals(entity, def));
  let insertY = insertAnchorY;
  if (primary.length > 0) {
    const primaryScale = primary.length > 1 ? spec.scaleForMany : spec.scale;
    const primaryOffsets = iconLayout(primary.length, primaryScale);
    const primaryBottom = primary.reduce((bottom, _entry, index) => {
      const y = entity.position.y + spec.shift[1] + (primaryOffsets[index]?.[1] ?? 0);
      return Math.max(bottom, y + primaryScale / 2);
    }, Number.NEGATIVE_INFINITY);
    const assemblerInsertYOffset = def.kind === "assembler" ? ASSEMBLER_INSERT_PLAN_Y_OFFSET : 0;
    insertY = primaryBottom + insertLayout.scale / 2 + assemblerInsertYOffset;
  }

  return insertPlans.map(({ frame }, index) => ({
    kind: "icon" as const,
    layer,
    sortY: 0,
    sortX: 0,
    entity: entity.entity_number,
    sub: 20 + index,
    frame,
    x: entity.position.x + spec.shift[0] + (insertLayout.xOffsets[index] ?? 0),
    y: insertY,
    size: insertLayout.scale,
    ...(useRequestPin
      ? { backingFrame: pinBackingFrame, backingStyle: "request-pin" as const }
      : darkBackingFrame !== undefined
        ? { backingFrame: darkBackingFrame }
        : { backing: true }),
  }));
}
