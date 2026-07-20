import { dirs4, isSprite4Way, leafLayers, round4, type FrameBank } from "../../sprite.js";
import type {
  EntityRenderData,
  EntityRenderDef,
  PipeCoverGraphics,
  RawSprite,
  SpriteVariant,
} from "../../types.js";

/** NESW bitmask "0000".."1111" → pipe picture key. */
export const PIPE_MASK_KEYS: Record<string, string> = {
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
export const PIPE_WINDOW_BACKGROUND_KEYS: Readonly<Record<string, string>> = {
  "1010": "vertical_window_background",
  "0101": "horizontal_window_background",
};

/** Heat-pipe connection_sprites use different corner names than pipes. */
export const HEAT_PIPE_MASK_KEYS: Record<string, string> = {
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

export const CARDINAL_DIRS = [0, 4, 8, 12] as const;
export const DIR_DELTA: Record<0 | 4 | 8 | 12, [number, number]> = {
  0: [0, -1],
  4: [1, 0],
  8: [0, 1],
  12: [-1, 0],
};

export function rotateOffset(x: number, y: number, dir: 0 | 4 | 8 | 12): [number, number] {
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

export interface RawPipeConnection {
  position?: [number, number];
  direction?: number;
  connection_type?: string;
  flow_direction?: string;
  hide_connection_info?: boolean;
}

export type FluidConnectionRole = "input" | "output";
export type FluidConnectionFlow = "input" | "output" | "input-output";

interface RawFluidConn extends RawPipeConnection {
  role: FluidConnectionRole;
  flow: FluidConnectionFlow;
  hideInfo: boolean;
}

export interface FluidConnectionsResult {
  connections: Record<string, [number, number][]>;
  /** Parallel to `connections[dir]` — fluid-box production_type per offset. */
  roles: Record<string, FluidConnectionRole[]>;
  /** Parallel — pipe-connection `flow_direction` for alt-mode arrows. */
  flows: Record<string, FluidConnectionFlow[]>;
  /** Parallel — absolute cardinal facing (`0|4|8|12`) per offset. */
  facings: Record<string, number[]>;
  /** Parallel — `hide_connection_info` (skip alt-mode arrows when true). */
  hideInfo: Record<string, boolean[]>;
}

function collectFluidBoxes(p: Record<string, unknown>): Record<string, unknown>[] {
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
  return boxes;
}

function boxProductionRole(box: Record<string, unknown>): FluidConnectionRole {
  // Factorio FluidBox.production_type: "input" | "output" | "input-output" | "none".
  // Treat anything other than explicit "output" as input for cover/joint gating.
  return box.production_type === "output" ? "output" : "input";
}

function connectionFlow(c: RawPipeConnection): FluidConnectionFlow {
  // Factorio default is "input-output" when omitted (pipeline entities omit it).
  if (c.flow_direction === "input" || c.flow_direction === "output") return c.flow_direction;
  return "input-output";
}

/**
 * Compute fluidConnections: entityDir → list of pipe-tile offsets (relative to
 * entity center) where a connecting pipe sits. Derived from prototype
 * pipe_connections by rotating position+direction. Also returns parallel
 * production_type roles for recipe-gated assemblers, plus flow/facing/hide
 * metadata for alt-mode fluid indication arrows.
 */
export function computeFluidConnections(p: Record<string, unknown>): FluidConnectionsResult {
  const boxes = collectFluidBoxes(p);

  const rawConns: RawFluidConn[] = [];
  for (const b of boxes) {
    const role = boxProductionRole(b);
    const pcs = b.pipe_connections as RawPipeConnection[] | undefined;
    if (!pcs) continue;
    for (const c of pcs) {
      // Skip underground-only links (pipe-to-ground far side).
      if (c.connection_type === "underground") continue;
      if (!c.position || c.direction == null) continue;
      rawConns.push({
        ...c,
        role,
        flow: connectionFlow(c),
        hideInfo: c.hide_connection_info === true,
      });
    }
  }
  if (rawConns.length === 0) {
    return { connections: {}, roles: {}, flows: {}, facings: {}, hideInfo: {} };
  }

  const connections: Record<string, [number, number][]> = {};
  const roles: Record<string, FluidConnectionRole[]> = {};
  const flows: Record<string, FluidConnectionFlow[]> = {};
  const facings: Record<string, number[]> = {};
  const hideInfo: Record<string, boolean[]> = {};
  for (const ed of CARDINAL_DIRS) {
    const seen = new Set<string>();
    const list: [number, number][] = [];
    const roleList: FluidConnectionRole[] = [];
    const flowList: FluidConnectionFlow[] = [];
    const facingList: number[] = [];
    const hideList: boolean[] = [];
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
      roleList.push(c.role);
      flowList.push(c.flow);
      facingList.push(card);
      hideList.push(c.hideInfo);
    }
    connections[String(ed)] = list;
    roles[String(ed)] = roleList;
    flows[String(ed)] = flowList;
    facings[String(ed)] = facingList;
    hideInfo[String(ed)] = hideList;
  }
  return { connections, roles, flows, facings, hideInfo };
}

/** Heat connection pipe-tile offsets from heat_buffer / energy_source.connections. */
export function computeHeatConnections(
  p: Record<string, unknown>,
): Record<string, [number, number][]> {
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

export function withFluidData(
  def: EntityRenderDef,
  p: Record<string, unknown>,
  extra?: EntityRenderData,
): EntityRenderDef {
  const {
    connections: fluidConnections,
    roles: fluidConnectionRoles,
    flows: fluidConnectionFlows,
    facings: fluidConnectionFacings,
    hideInfo: fluidConnectionHideInfo,
  } = computeFluidConnections(p);
  const heatConnections = computeHeatConnections(p);
  const data: EntityRenderData = { ...def.data, ...extra };
  if (Object.keys(fluidConnections).length > 0) {
    data.fluidConnections = fluidConnections;
    data.fluidConnectionRoles = fluidConnectionRoles;
    data.fluidConnectionFlows = fluidConnectionFlows;
    data.fluidConnectionFacings = fluidConnectionFacings;
    data.fluidConnectionHideInfo = fluidConnectionHideInfo;
  }
  if (Object.keys(heatConnections).length > 0) data.heatConnections = heatConnections;
  if (p.fluid_boxes_off_when_no_fluid_recipe === true) {
    data.fluidBoxesRequireFluidRecipe = true;
  }
  if (Object.keys(data).length === 0) return def;
  return { ...def, data };
}

/**
 * Map FluidBox `enable_working_visualisations` names to graphics group indices
 * produced for those named idle WVs, keyed by fluid-box production_type role.
 */
export function fluidWorkingVisualisationGroupsFromBoxes(
  p: Record<string, unknown>,
  namedGroupIndices: Record<string, number[]>,
): EntityRenderData["fluidWorkingVisualisationGroups"] | undefined {
  if (Object.keys(namedGroupIndices).length === 0) return undefined;
  const input = new Set<number>();
  const output = new Set<number>();
  for (const box of collectFluidBoxes(p)) {
    const names = box.enable_working_visualisations;
    if (!Array.isArray(names) || names.length === 0) continue;
    const role = boxProductionRole(box);
    const target = role === "output" ? output : input;
    for (const name of names) {
      if (typeof name !== "string") continue;
      for (const index of namedGroupIndices[name] ?? []) target.add(index);
    }
  }
  if (input.size === 0 && output.size === 0) return undefined;
  const out: NonNullable<EntityRenderData["fluidWorkingVisualisationGroups"]> = {};
  if (input.size > 0) out.input = [...input].sort((a, b) => a - b);
  if (output.size > 0) out.output = [...output].sort((a, b) => a - b);
  return out;
}

/** Recipes whose ingredients and/or results include `type: "fluid"`. */
export function distillFluidRecipes(
  recipes: Record<string, unknown> | undefined,
): Record<string, { ingredients: boolean; products: boolean }> {
  const out: Record<string, { ingredients: boolean; products: boolean }> = {};
  if (!recipes) return out;
  for (const [name, raw] of Object.entries(recipes)) {
    if (!raw || typeof raw !== "object") continue;
    const recipe = raw as { ingredients?: unknown; results?: unknown };
    const ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.some(
          (entry) =>
            entry != null &&
            typeof entry === "object" &&
            (entry as { type?: unknown }).type === "fluid",
        )
      : false;
    const products = Array.isArray(recipe.results)
      ? recipe.results.some(
          (entry) =>
            entry != null &&
            typeof entry === "object" &&
            (entry as { type?: unknown }).type === "fluid",
        )
      : false;
    if (ingredients || products) out[name] = { ingredients, products };
  }
  return out;
}

type PipeCoversCached = {
  key: string;
  covers: SpriteVariant[];
  shadows?: SpriteVariant[];
};

/** Per-bank cache so parallel local FrameBanks never share foreign frame ids. */
const pipeCoversByBank = new WeakMap<FrameBank, PipeCoversCached>();

export function pipeCoversKey(covers: RawSprite): string {
  const dirs = dirs4(covers);
  return dirs
    .map((d) => {
      const leaves = leafLayers(d);
      return leaves.map((l) => `${l.filename ?? ""}:${l.width ?? 0}x${l.height ?? 0}`).join("+");
    })
    .join("|");
}

export function firstPipeCoversSprite(p: Record<string, unknown>): RawSprite | undefined {
  for (const b of collectFluidBoxes(p)) {
    const pc = b.pipe_covers as RawSprite | undefined;
    if (pc && isSprite4Way(pc)) return pc;
  }
  return undefined;
}

/**
 * Factorio FluidBox.always_draw_covers: defaults to true when `pipe_picture`
 * is absent, false when present (unless the prototype sets it explicitly).
 */
export function effectiveAlwaysDrawPipeCovers(p: Record<string, unknown>): boolean {
  let anyBox = false;
  for (const b of collectFluidBoxes(p)) {
    anyBox = true;
    if (b.always_draw_covers === true) return true;
    if (b.always_draw_covers === false) continue;
    const pp = b.pipe_picture;
    const hasPicture = pp != null && typeof pp === "object" && isSprite4Way(pp as RawSprite);
    if (!hasPicture) return true;
  }
  return !anyBox;
}

/**
 * Distill fluid-box pipe_covers (Sprite4Way) into data.pipeCovers.
 * Drawn by the planner on unconnected ports (Factorio caps open flanges),
 * or on all active ports when alwaysDrawPipeCovers is set.
 */
export async function withPipeCovers(
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
  let cached = pipeCoversByBank.get(bank);
  if (!cached || cached.key !== key) {
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
    cached = {
      key,
      covers,
      shadows: shadows.length === 4 ? shadows : undefined,
    };
    pipeCoversByBank.set(bank, cached);
  }

  const alwaysDraw = effectiveAlwaysDrawPipeCovers(p);
  return {
    ...def,
    data: {
      ...def.data,
      pipeCovers: {
        covers: cached.covers,
        shadows: cached.shadows,
      },
      ...(alwaysDraw ? { alwaysDrawPipeCovers: true } : {}),
    },
  };
}

/** WeakMap entries drop with their FrameBank; kept for distillAndPack call sites. */
export function clearPipeCoversCache(): void {
  // No module-level cache to clear; banks are discarded between runs.
}

type PipePicturesCached = Map<string, PipeCoverGraphics | null>;

const pipePicturesByBank = new WeakMap<FrameBank, PipePicturesCached>();

/**
 * Bank one FluidBox.pipe_picture Sprite4Way into PipeCoverGraphics.
 * Returns null when the picture is missing, empty, or has no usable leaves.
 */
async function distillPipePictureSprite4Way(
  bank: FrameBank,
  picture: unknown,
): Promise<PipeCoverGraphics | null> {
  if (!picture || typeof picture !== "object") return null;
  const sprite = picture as RawSprite;
  if (!isSprite4Way(sprite)) return null;

  const key = pipeCoversKey(sprite);
  let cache = pipePicturesByBank.get(bank);
  if (!cache) {
    cache = new Map();
    pipePicturesByBank.set(bank, cache);
  }
  if (cache.has(key)) return cache.get(key) ?? null;

  const dirSprites = [sprite.north, sprite.east, sprite.south, sprite.west];
  const covers: (SpriteVariant | null)[] = [];
  const shadows: (SpriteVariant | null)[] = [];
  let any = false;
  for (const dir of dirSprites) {
    if (!dir || typeof dir !== "object") {
      covers.push(null);
      shadows.push(null);
      continue;
    }
    const leaves = leafLayers(dir as RawSprite).filter(
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
    covers.push(cover ?? null);
    shadows.push(shadow ?? null);
    if (cover) any = true;
  }

  const result: PipeCoverGraphics | null = any
    ? { covers, shadows: shadows.some((s) => s != null) ? shadows : undefined }
    : null;
  cache.set(key, result);
  return result;
}

/**
 * Distill FluidBox.pipe_picture (Sprite4Way) per fluid connection into
 * data.pipePictures — parallel to fluidConnections indices (dir "0" order).
 * Drawn by the planner on active ports at entity center (machine-side stubs).
 */
export async function withPipePictures(
  bank: FrameBank,
  def: EntityRenderDef,
  p: Record<string, unknown>,
): Promise<EntityRenderDef> {
  if (def.kind === "pipe" || def.protoType === "pipe-to-ground") return def;
  if (!def.data?.fluidConnections) return def;

  type RawWithPicture = RawFluidConn & { picture: unknown };
  const rawConns: RawWithPicture[] = [];
  for (const b of collectFluidBoxes(p)) {
    const pcs = b.pipe_connections as RawPipeConnection[] | undefined;
    if (!pcs) continue;
    const picture = b.pipe_picture;
    for (const c of pcs) {
      if (c.connection_type === "underground") continue;
      if (!c.position || c.direction == null) continue;
      rawConns.push({
        ...c,
        role: boxProductionRole(b),
        flow: connectionFlow(c),
        hideInfo: c.hide_connection_info === true,
        picture,
      });
    }
  }
  if (rawConns.length === 0) return def;

  // Same dir-0 walk + offset dedupe as computeFluidConnections.
  const seen = new Set<string>();
  const pictures: (PipeCoverGraphics | null)[] = [];
  for (const c of rawConns) {
    const [px, py] = c.position as [number, number];
    const absDir = (((c.direction as number) % 16) + 16) % 16;
    const snapped = (Math.round(absDir / 4) * 4) % 16;
    const card = (
      snapped === 0 || snapped === 4 || snapped === 8 || snapped === 12 ? snapped : 0
    ) as 0 | 4 | 8 | 12;
    const [dx, dy] = DIR_DELTA[card];
    const ox = round4(px + dx);
    const oy = round4(py + dy);
    const key = `${ox},${oy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pictures.push(await distillPipePictureSprite4Way(bank, c.picture));
  }

  if (pictures.every((pic) => pic == null)) return def;

  return {
    ...def,
    data: {
      ...def.data,
      pipePictures: pictures,
    },
  };
}

export function clearPipePicturesCache(): void {
  // WeakMap entries drop with their FrameBank.
}
