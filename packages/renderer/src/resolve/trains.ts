/**
 * Vehicle RotatedAnimation art is already authored in oblique screen angles.
 * Convert the world-space orientation back into that authored ellipse before
 * selecting a pose. This is the inverse axis scaling of rolling-stock
 * projection; vehicles also have no rail/bogie geometry.
 */
export function projectVehicleOrientation(orientation: number): number {
  const turn = ((orientation % 1) + 1) % 1;
  let x = Math.sin(turn * Math.PI * 2);
  const y = -Math.cos(turn * Math.PI * 2);
  x *= Math.SQRT1_2;
  let out = Math.atan2(x, -y) / (Math.PI * 2);
  if (out < 0) out += 1;
  return out;
}

/**
 * Map continuous blueprint `orientation` ∈ [0,1) to a distilled pose index.
 * `round(orientation * N) % N` — orientation 0 → pose 0 (north).
 *
 * With `backEqualsFront` (cargo/fluid wagons): the sheet only authors half a
 * turn; Factorio indexes as `round(o * 2N) % N` so east and west share a pose.
 * @see FBSR FPRotatedSprite.getIndex
 */
export function trainOrientationIndex(
  orientation: number,
  poseCount: number,
  backEqualsFront = false,
): number {
  if (poseCount <= 0) return 0;
  const o = ((orientation % 1) + 1) % 1;
  if (backEqualsFront) {
    return Math.round(o * poseCount * 2) % poseCount;
  }
  return Math.round(o * poseCount) % poseCount;
}

/**
 * Factorio's camera is a 45° orthographic tilt: circular orientations project
 * onto an ellipse (Y scaled by 1/√2) before picking rotated sprites.
 * @see https://forums.factorio.com/viewtopic.php?t=109695
 */
export function projectTrainOrientation(orientation: number): number {
  const turn = ((orientation % 1) + 1) % 1;
  const x = Math.sin(turn * Math.PI * 2);
  let y = -Math.cos(turn * Math.PI * 2);
  y *= Math.SQRT1_2;
  let out = Math.atan2(x, -y) / (Math.PI * 2);
  if (out < 0) out += 1;
  return out;
}

/**
 * Rolling-stock "rail shift": FBSR stores this as height and flattens with
 * `y - height`. Equivalent forum form: `-(0.25 * abs(cos(o*TAU + PI/2)))`.
 * @see https://forums.factorio.com/viewtopic.php?t=109695
 */
export function trainRailShiftY(orientation: number): number {
  const o = ((orientation % 1) + 1) % 1;
  const angle = o * Math.PI * 2;
  return -0.25 * Math.abs(Math.cos(angle + Math.PI / 2));
}

/** Factorio oblique Y/Z scale (1/√2). @see FBSR FPUtils.PROJECTION_CONSTANT */
const TRAIN_PROJECTION = Math.SQRT1_2;

/**
 * Artillery-wagon cannon mount offset (tile units, before rail-shift Y).
 * Ports FBSR ArtilleryWagonRendering.calculateCannonPosition for slope=0.
 */
export function artilleryCannonShift(
  orientation: number,
  opts: {
    cannonBaseHeight?: number;
    cannonBaseShiftWhenVertical?: number;
    cannonBaseShiftWhenHorizontal?: number;
    /** Distilled pose count; used to snap orientation like FBSR getAlignedOrientation. */
    orientationCount?: number;
  },
): [number, number] {
  const o = ((orientation % 1) + 1) % 1;
  const n =
    typeof opts.orientationCount === "number" && opts.orientationCount > 0
      ? opts.orientationCount
      : 64;
  const projected = projectTrainOrientation(o);
  const aligned = trainOrientationIndex(projected, n) / n;
  const vf = Math.abs(Math.abs(aligned - 0.5) - 0.25) * 4;
  const vert = opts.cannonBaseShiftWhenVertical ?? 0;
  const horiz = opts.cannonBaseShiftWhenHorizontal ?? 0;
  const offsetForward = -(vert * vf + horiz * (1 - vf));
  const offsetHeight = opts.cannonBaseHeight ?? 0;
  // FBSR: rotation = orientation * TAU + PI/2
  const rotation = o * Math.PI * 2 + Math.PI / 2;
  const offsetX = offsetForward * Math.cos(rotation);
  const offsetY = offsetForward * Math.sin(rotation);
  // flatten: (x, y * P - height * P)
  return [offsetX, offsetY * TRAIN_PROJECTION - offsetHeight * TRAIN_PROJECTION];
}

/** Dual bogie shifts for a rolling-stock entity (tile units relative to center). */
export function trainWheelShifts(
  orientation: number,
  jointDistance: number,
): { shift: [number, number]; orientation: number }[] {
  const o = ((orientation % 1) + 1) % 1;
  const projected = projectTrainOrientation(o);
  const half = jointDistance / 2;
  const angle = o * Math.PI * 2;
  const ox = Math.sin(angle) * half;
  const oy = -Math.cos(angle) * half;
  const vert = trainRailShiftY(o);
  // Couplers are baked into the wheel sprite on one end only. Forward bogie
  // (+joint/2) uses orientation+0.5 so its hook faces outward; rearward bogie
  // keeps body orientation. Matching FBSR's front=orientation leaves both
  // hooks inward and dark bogie backs in the inter-wagon gap.
  const flipped = projectTrainOrientation((o + 0.5) % 1);
  return [
    { shift: [ox, oy + vert], orientation: flipped },
    { shift: [-ox, -oy + vert], orientation: projected },
  ];
}

/**
 * Map blueprint rail direction (0..15) to a direction8 picture index.
 * Straight / half-diagonal pieces only author 4 of 8 keys; fold 4..7 → 0..3.
 */
export function railDirectionIndex(direction: number, foldTo4: boolean): number {
  let i = Math.floor((((direction % 16) + 16) % 16) / 2) % 8;
  if (foldTo4) i = i % 4;
  return i;
}
