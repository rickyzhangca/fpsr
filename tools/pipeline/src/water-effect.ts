export interface RgbaImageData {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface FrozenWaterParameters {
  effectColor: [number, number, number];
  specularLightness: [number, number, number];
  foamColor: [number, number, number];
  darkThreshold: number;
  reflectionThreshold: number;
  specularThreshold: number;
  animationSpeed: number;
  animationScale: number;
  frozenTime: number;
}

export interface BakeFrozenWaterOptions {
  maskSheet: RgbaImageData;
  maskFrameSize: number;
  maskFrameCount: number;
  noiseTexture: RgbaImageData;
  parameters: FrozenWaterParameters;
  underwaterColor: [number, number, number];
  supertileTiles?: number;
  sourcePixelsPerTile?: number;
  maskPatchTiles?: number;
  seamBlendTiles?: number;
}

export interface BakedWaterSurface {
  rgba: Buffer;
  width: number;
  height: number;
}

export const WATER_SUPERTILE_TILES = 32;
export const WATER_MASK_PATCH_TILES = 4;
export const WATER_SOURCE_PIXELS_PER_TILE = 64;

const WATER_UV_Y_STRETCH = 1.414;
const WATER_FBM_OCTAVES = 3;
const WATER_FBM_SCALE = 1.1;
const WATER_FBM_WEIGHT = 0.75;
const WATER_ROTATION = 3;
const WATER_ROTATION_NOISE = 0.02;
const WATER_TIME_DRIFT = 0.0025;
const UINT32_RANGE = 4_294_967_296;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const unit = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return unit * unit * (3 - 2 * unit);
}

function terrainCellHash(cellX: number, cellY: number): number {
  let hash = (Math.imul(cellX | 0, 374_761_393) + Math.imul(cellY | 0, 668_265_263)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function assertRgbaImage(image: RgbaImageData, label: string): void {
  if (image.width <= 0 || image.height <= 0) throw new Error(`${label} has invalid dimensions`);
  if (image.data.length !== image.width * image.height * 4) {
    throw new Error(`${label} must contain four-channel RGBA pixels`);
  }
}

/** Bilinear red-channel sampling with the same repeat addressing used by Factorio's effect texture. */
export function sampleWrappedRed(image: RgbaImageData, u: number, v: number): number {
  const wrappedU = u - Math.floor(u);
  const wrappedV = v - Math.floor(v);
  const x = wrappedU * image.width - 0.5;
  const y = wrappedV * image.height - 0.5;
  const x0Floor = Math.floor(x);
  const y0Floor = Math.floor(y);
  const tx = x - x0Floor;
  const ty = y - y0Floor;
  const x0 = ((x0Floor % image.width) + image.width) % image.width;
  const y0 = ((y0Floor % image.height) + image.height) % image.height;
  const x1 = (x0 + 1) % image.width;
  const y1 = (y0 + 1) % image.height;
  const at = (pixelX: number, pixelY: number): number =>
    (image.data[(pixelY * image.width + pixelX) * 4] ?? 0) / 255;
  const top = mix(at(x0, y0), at(x1, y0), tx);
  const bottom = mix(at(x0, y1), at(x1, y1), tx);
  return mix(top, bottom, ty);
}

/** Three-octave FBM ported from Factorio's tiles-water-effect fragment shader. */
export function sampleWaterFbm(
  noise: RgbaImageData,
  initialU: number,
  initialV: number,
  time: number,
): number {
  let u = initialU;
  let v = initialV;
  let value = 0;
  let total = 0;
  let weight = 1;
  const sinRotation = Math.sin(WATER_ROTATION);
  const cosRotation = Math.cos(WATER_ROTATION);

  for (let octave = 0; octave < WATER_FBM_OCTAVES; octave++) {
    const drift = time * WATER_TIME_DRIFT * (1 - weight);
    value += sampleWrappedRed(noise, u + drift, v + drift) * weight;
    total += weight;

    let rotatedU = u * WATER_FBM_SCALE;
    let rotatedV = v * WATER_FBM_SCALE;
    const perturbation = sampleWrappedRed(noise, rotatedU * 2, rotatedV * 2) * WATER_ROTATION_NOISE;
    rotatedU += perturbation;
    rotatedV += perturbation;
    u = rotatedU * cosRotation - rotatedV * sinRotation;
    v = rotatedU * sinRotation + rotatedV * cosRotation;
    weight *= WATER_FBM_WEIGHT;
  }

  return value / total;
}

export function shadeFrozenWaterPixel(
  noiseValue: number,
  mask: [number, number, number],
  parameters: FrozenWaterParameters,
): [number, number, number, number] {
  const value = noiseValue + 0.1;
  const darks = 1 - Math.ceil(value + parameters.darkThreshold);
  const reflection = smoothstep(
    0,
    parameters.reflectionThreshold,
    1 - value * 0.8 - 0.6 + mask[0] * 0.25,
  );
  const specular = clamp(Math.ceil(value + parameters.specularThreshold - mask[0]), 1, 2);
  const baseMultiplier = value + specular * 0.19 - mask[2] * 0.3;
  const darkMix = darks * 0.11;
  const reflectionMix = clamp(reflection, 0, 0.5);
  const transparency = 1 - mask[1];
  const foamMix = smoothstep(-0.35, 0.3, mask[2] - value * 2.15);
  const output: [number, number, number, number] = [0, 0, 0, 0];

  for (let channel = 0; channel < 3; channel++) {
    let color = (parameters.effectColor[channel] ?? 0) * baseMultiplier;
    color = mix(color, color * -(parameters.specularLightness[channel] ?? 0), darkMix);
    color = mix(color, color * color * 1.5, reflectionMix);
    color *= transparency;
    color = mix(color, parameters.foamColor[channel] ?? 0, foamMix);
    output[channel] = clamp(color, 0, 1);
  }
  // Factorio's shader treats these colors as premultiplied: the green mask attenuates the
  // complete vec4 before opaque foam is mixed back in. Preserve that alpha for composition.
  let alpha = mix(1, -1, darkMix);
  alpha *= transparency;
  output[3] = clamp(mix(alpha, 1, foamMix), 0, 1);
  return output;
}

function seamlessNoiseValue(
  options: BakeFrozenWaterOptions,
  x: number,
  y: number,
  width: number,
  height: number,
  blendPixels: number,
): number {
  const { noiseTexture, parameters } = options;
  const animationOffset =
    Math.sin(parameters.frozenTime * parameters.animationSpeed) * parameters.animationScale;
  const sampleAt = (sampleX: number, sampleY: number): number =>
    sampleWaterFbm(
      noiseTexture,
      (sampleX + 0.5) / noiseTexture.width + animationOffset,
      ((sampleY + 0.5) / noiseTexture.height) * WATER_UV_Y_STRETCH + animationOffset,
      parameters.frozenTime,
    );

  const xBlend = x < blendPixels ? smoothstep(0, blendPixels, x) : 1;
  const yBlend = y < blendPixels ? smoothstep(0, blendPixels, y) : 1;
  let value = sampleAt(x, y);
  if (xBlend < 1) value = mix(sampleAt(x + width - 1, y), value, xBlend);
  if (yBlend < 1) {
    let wrappedY = sampleAt(x, y + height - 1);
    if (xBlend < 1) {
      wrappedY = mix(sampleAt(x + width - 1, y + height - 1), wrappedY, xBlend);
    }
    value = mix(wrappedY, value, yBlend);
  }
  return value;
}

/**
 * Bake Factorio's animated water shader at a fixed time into a large, world-repeatable surface.
 * Only a narrow top/left band is blended against the opposite edge, keeping the interior shader
 * output exact while making Canvas2D repetition continuous at the supertile boundary.
 */
export function bakeFrozenWaterSurface(options: BakeFrozenWaterOptions): BakedWaterSurface {
  assertRgbaImage(options.maskSheet, "water mask sheet");
  assertRgbaImage(options.noiseTexture, "water noise texture");
  const sourcePixelsPerTile = options.sourcePixelsPerTile ?? WATER_SOURCE_PIXELS_PER_TILE;
  const supertileTiles = options.supertileTiles ?? WATER_SUPERTILE_TILES;
  const maskPatchTiles = options.maskPatchTiles ?? WATER_MASK_PATCH_TILES;
  const seamBlendTiles = options.seamBlendTiles ?? 2;
  const width = supertileTiles * sourcePixelsPerTile;
  const height = width;
  const maskPatchPixels = maskPatchTiles * sourcePixelsPerTile;
  const blendPixels = Math.max(1, Math.min(width, seamBlendTiles * sourcePixelsPerTile));
  if (options.maskFrameSize !== maskPatchPixels) {
    throw new Error(
      `water mask frame is ${options.maskFrameSize}px; expected ${maskPatchPixels}px ` +
        `for ${maskPatchTiles} tiles`,
    );
  }
  if (options.maskFrameCount <= 0) throw new Error("water mask sheet has no frames");
  if (options.maskSheet.width < options.maskFrameSize * options.maskFrameCount) {
    throw new Error("water mask sheet is narrower than its declared frames");
  }
  if (options.maskSheet.height < options.maskFrameSize) {
    throw new Error("water mask sheet is shorter than its declared frame size");
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const cellY = Math.floor(y / maskPatchPixels);
    const maskY = y % maskPatchPixels;
    for (let x = 0; x < width; x++) {
      const cellX = Math.floor(x / maskPatchPixels);
      const maskX = x % maskPatchPixels;
      const variantUnit = terrainCellHash(cellX, cellY) / UINT32_RANGE;
      const variant = Math.min(
        options.maskFrameCount - 1,
        Math.floor(variantUnit * options.maskFrameCount),
      );
      const maskOffset = (maskY * options.maskSheet.width + variant * maskPatchPixels + maskX) * 4;
      const mask: [number, number, number] = [
        (options.maskSheet.data[maskOffset] ?? 0) / 255,
        (options.maskSheet.data[maskOffset + 1] ?? 0) / 255,
        (options.maskSheet.data[maskOffset + 2] ?? 0) / 255,
      ];
      const noiseValue = seamlessNoiseValue(options, x, y, width, height, blendPixels);
      const water = shadeFrozenWaterPixel(noiseValue, mask, options.parameters);
      const outputOffset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const background = clamp(options.underwaterColor[channel] ?? 0, 0, 1);
        const composed = (water[channel] ?? 0) + background * (1 - water[3]);
        rgba[outputOffset + channel] = Math.round(clamp(composed, 0, 1) * 255);
      }
      rgba[outputOffset + 3] = 255;
    }
  }

  return { rgba, width, height };
}
