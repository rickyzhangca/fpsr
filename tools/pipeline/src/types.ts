/** The renderer owns the RenderDb contract; the pipeline only produces it. */
export type {
  AtlasMeta,
  BeltConnectorGraphics,
  BeltReaderGraphics,
  CargoBayConnectionCell,
  CargoBayConnectionLayer,
  CargoBayConnections,
  CombinatorGraphics,
  DirectionalConnectionMap,
  EntityKind,
  EntityRenderData,
  EntityRenderDef,
  FactorioRenderLayerName,
  FpsrRenderLayerName,
  FrameId,
  FrameMeta,
  LayerGroup,
  PipeCoverGraphics,
  RenderDb,
  RenderLayerName,
  SpaceBackground,
  SpriteVariant,
  TerrainBackgroundName,
  TerrainBackgrounds,
  TerrainPatchBackground,
  TerrainPatchSet,
  TileMaterialAtlas,
  TileRenderDef,
  WireAnchorMap,
  WireAnchorSet,
  WireConnectorGraphics,
  WireConnectorLayerName,
} from "fpsr";

/** Loose Factorio sprite / animation table from data-raw-dump.json. */
export interface RawSprite {
  filename?: string;
  filenames?: string[];
  width?: number;
  height?: number;
  size?: number | [number, number];
  x?: number;
  y?: number;
  position?: [number, number];
  shift?: [number, number];
  scale?: number;
  frame_count?: number;
  /** RotatedAnimation frame used when the animation is not running. */
  still_frame?: number;
  /**
   * SpriteNWaySheet: how many direction frames are packed in this sheet
   * (Factorio uses `frames`, not `frame_count`, for storage-tank etc.).
   */
  frames?: number;
  line_length?: number;
  direction_count?: number;
  /** When true, sheet authors half a turn; east/west share poses. */
  back_equals_front?: boolean;
  lines_per_file?: number;
  repeat_count?: number;
  variation_count?: number;
  tint?: number[] | { r?: number; g?: number; b?: number; a?: number };
  draw_as_shadow?: boolean;
  draw_as_light?: boolean;
  /** Additive glow sheets are mostly opaque black + bright pixels; skip for idle. */
  draw_as_glow?: boolean;
  blend_mode?: string;
  apply_runtime_tint?: boolean;
  /** LayeredSprite / picture-array entry render layer from dump. */
  render_layer?: string;
  /** RotatedAnimation stripes: direction rows split across one or more files. */
  stripes?: {
    filename: string;
    width_in_frames: number;
    height_in_frames: number;
  }[];
  layers?: RawSprite[];
  sheet?: RawSprite;
  sheets?: RawSprite[];
  north?: RawSprite;
  east?: RawSprite;
  south?: RawSprite;
  west?: RawSprite;
  [key: string]: unknown;
}

export type DataRaw = Record<string, Record<string, Record<string, unknown>>>;
