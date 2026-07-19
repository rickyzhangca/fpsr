import type {
  CanvasFillStyle,
  CanvasLineCap,
  CanvasTextAlign,
  CanvasTextBaseline,
  GlobalCompositeOperation,
  ImageSource,
} from "../host.js";
import type { FrameMeta, SpaceBackground, TerrainPatchBackground } from "../types/render-db.js";

/** Minimal Canvas 2D surface used by the backend (browser or skia-canvas). */
export interface Canvas2DContextLike {
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  translate(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(): void;
  roundRect?(x: number, y: number, w: number, h: number, radii: number | number[]): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  drawImage(image: ImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: ImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillText(text: string, x: number, y: number): void;
  set fillStyle(value: CanvasFillStyle);
  set strokeStyle(value: CanvasFillStyle);
  set lineWidth(value: number);
  set lineCap(value: CanvasLineCap);
  set globalAlpha(value: number);
  get globalAlpha(): number;
  set globalCompositeOperation(value: GlobalCompositeOperation);
  get globalCompositeOperation(): GlobalCompositeOperation;
  set filter(value: string);
  set font(value: string);
  set textBaseline(value: CanvasTextBaseline);
  set textAlign(value: CanvasTextAlign);
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality?: "low" | "medium" | "high";
}

export interface ExecuteDrawListOptions {
  pixelsPerTile: number;
  padTiles?: number;
  /** Integer tile viewport; when set, canvas origin aligns to tile grid. */
  tileFrame?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Full output frame when `tileFrame` is only one tiled-render viewport. */
  outputTileFrame?: { minX: number; minY: number; maxX: number; maxY: number };
  background?: [number, number, number, number] | null;
  /** Draw tile-aligned checkerboard behind commands (replaces solid background). */
  showCheckerboard?: boolean;
  /** Draw a procedural space starfield behind commands (replaces solid/checkerboard). */
  showSpace?: boolean;
  /**
   * When `showSpace` is set, also draw the render-db space-platform planet
   * (e.g. Nauvis) in the bottom-left. Starfield-only when omitted/false.
   */
  showSpacePlanet?: boolean;
  /** Selected natural-terrain definition from the render database. */
  terrainBackground?: TerrainPatchBackground;
  /** Optional space-platform planet decoration from the render database. */
  spaceBackground?: SpaceBackground;
  /** Draw tile grid lines and map-space coordinate labels after commands. */
  showCoordinates?: boolean;
  /** Transparent per-frame icon crops used for alpha-safe silhouette filtering. */
  iconImages?: ReadonlyMap<number, ImageSource>;
  /** Padded, dilated black silhouettes keyed by icon frame index. */
  silhouetteImages?: ReadonlyMap<number, ImageSource>;
  /**
   * Frame table from the RenderDb that produced `list`. Required for trim math;
   * not in the CONTRACTS.md sketch — see M1 report.
   */
  frames: FrameMeta[];
  /** Optional canvas factory for offscreen tint compositing (Node/skia). */
  createCanvas?: (
    width: number,
    height: number,
  ) => {
    width: number;
    height: number;
    getContext(type: "2d"): Canvas2DContextLike | null;
  };
  /** Shadow scratch-tile edge length. Defaults to 1024 px. */
  shadowTileSize?: number;
  /** Optional mutable performance counters populated during painting. */
  stats?: ExecuteDrawListStats;
}

export interface ExecuteDrawListStats {
  shadowRuns: number;
  shadowTiles: number;
  shadowCompositedPixels: number;
  shadowPeakScratchPixels: number;
}
