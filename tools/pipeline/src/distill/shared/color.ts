import { round4 } from "../../sprite.js";

export function colorFromProto(
  p: Record<string, unknown>,
): [number, number, number, number] | undefined {
  const c = p.color as { r?: number; g?: number; b?: number; a?: number } | number[] | undefined;
  if (Array.isArray(c) && c.length >= 3) {
    return [
      round4(Number(c[0]) || 0),
      round4(Number(c[1]) || 0),
      round4(Number(c[2]) || 0),
      round4(c[3] == null ? 1 : Number(c[3]) || 0),
    ];
  }
  if (!c || typeof c !== "object") return undefined;
  const rgba = c as { r?: number; g?: number; b?: number; a?: number };
  return [round4(rgba.r ?? 1), round4(rgba.g ?? 1), round4(rgba.b ?? 1), round4(rgba.a ?? 1)];
}
