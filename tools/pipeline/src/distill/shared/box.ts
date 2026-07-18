import { round4 } from "../../sprite.js";
import type { DataRaw } from "../../types.js";

export const EMPTY_BOX: [[number, number], [number, number]] = [
  [0, 0],
  [0, 0],
];

export function boxOf(
  proto: Record<string, unknown>,
  key: string,
): [[number, number], [number, number]] {
  const b = proto[key] as [[number, number], [number, number]] | undefined;
  if (!b) return EMPTY_BOX;
  return [
    [round4(b[0][0]), round4(b[0][1])],
    [round4(b[1][0]), round4(b[1][1])],
  ];
}

export function proto(raw: DataRaw, type: string, name: string): Record<string, unknown> {
  const p = raw[type]?.[name];
  if (!p) throw new Error(`Missing prototype ${type}/${name}`);
  return p;
}
