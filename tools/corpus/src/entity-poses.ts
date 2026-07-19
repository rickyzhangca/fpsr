import type { EntityRenderDef, LayerGroup } from "@rickyzhangca/fpsr/render-db";

export const CARDINAL_DIRECTIONS = [0, 4, 8, 12] as const;
export const DIRECTIONS_8 = [0, 2, 4, 6, 8, 10, 12, 14] as const;
export const DIRECTIONS_16 = Array.from({ length: 16 }, (_, index) => index);
export const ORIENTATIONS_64 = Array.from({ length: 64 }, (_, index) => index / 64);

export type EntityPoseMetadataSource =
  | "base-suite-contract"
  | "base-only-render-db"
  | "official-mod-render-db";

export interface EntityPose {
  axis: "single" | "direction" | "orientation";
  metadataSource: EntityPoseMetadataSource;
  direction?: number;
  orientation?: number;
  type?: "input" | "output";
}

export interface PoseContractSets {
  orientation64?: ReadonlySet<string>;
  direction16?: ReadonlySet<string>;
  direction8?: ReadonlySet<string>;
  contractMetadataSource?: EntityPoseMetadataSource;
  renderDbMetadataSource?: EntityPoseMetadataSource;
}

function slugPart(value: string | number): string {
  return String(value).padStart(2, "0");
}

export function poseSlug(pose: EntityPose): string {
  const poseId =
    pose.axis === "orientation"
      ? `o${slugPart(Math.round((pose.orientation ?? 0) * 64))}`
      : `d${slugPart(pose.direction ?? 0)}`;
  const typeId = pose.type ? `-${pose.type}` : "";
  return `${poseId}${typeId}`;
}

export function poseCellId(name: string, pose: EntityPose): string {
  return `pose/${name}/${poseSlug(pose)}`;
}

export function maxIndexing(def: EntityRenderDef): LayerGroup["indexing"] {
  const rank: Record<LayerGroup["indexing"], number> = {
    single: 0,
    resolver: 1,
    direction4: 2,
    direction8: 3,
    direction16: 4,
  };
  let best: LayerGroup["indexing"] = "single";
  for (const group of def.graphics) {
    if (rank[group.indexing] > rank[best]) best = group.indexing;
  }

  if (
    def.kind === "belt" ||
    def.kind === "underground-belt" ||
    def.kind === "loader" ||
    def.kind === "splitter" ||
    def.kind === "inserter" ||
    def.kind === "assembler" ||
    def.kind === "gate"
  ) {
    return "direction4";
  }
  if (best === "resolver") return "direction4";
  return best;
}

export function posesForEntity(
  name: string,
  def: EntityRenderDef,
  contract: PoseContractSets = {},
): EntityPose[] {
  const contractMetadataSource = contract.contractMetadataSource ?? "base-suite-contract";
  const renderDbMetadataSource = contract.renderDbMetadataSource ?? "base-only-render-db";
  const types: Array<"input" | "output" | undefined> =
    def.kind === "underground-belt" || def.kind === "loader" ? ["input", "output"] : [undefined];

  if (contract.orientation64?.has(name)) {
    return ORIENTATIONS_64.map((orientation) => ({
      axis: "orientation",
      metadataSource: contractMetadataSource,
      orientation,
    }));
  }

  let directions: readonly number[];
  let metadataSource: EntityPoseMetadataSource;
  if (contract.direction16?.has(name)) {
    directions = DIRECTIONS_16;
    metadataSource = contractMetadataSource;
  } else if (contract.direction8?.has(name)) {
    directions = DIRECTIONS_8;
    metadataSource = contractMetadataSource;
  } else {
    metadataSource = renderDbMetadataSource;
    switch (maxIndexing(def)) {
      case "direction16":
        directions = DIRECTIONS_16;
        break;
      case "direction8":
        directions = DIRECTIONS_8;
        break;
      case "direction4":
        directions = CARDINAL_DIRECTIONS;
        break;
      default:
        directions = [0];
        break;
    }
  }

  return directions.flatMap((direction) =>
    types.map((type) => ({
      axis: directions.length === 1 ? "single" : "direction",
      metadataSource,
      direction,
      ...(type ? { type } : {}),
    })),
  );
}
