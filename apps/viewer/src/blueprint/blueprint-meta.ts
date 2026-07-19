import {
  decodeVersion,
  encode,
  type Blueprint,
  type BlueprintBook,
  type BlueprintEntity,
} from "@rickyzhangca/fpsr";

export const formatGameVersion = (version: number): string => {
  const { major, minor, patch } = decodeVersion(version);
  return `${major}.${minor}.${patch}`;
};

export const formatSnapping = (bp: Blueprint): string => {
  const parts: string[] = [];
  if (bp["absolute-snapping"] === true) parts.push("absolute");
  else if (bp["absolute-snapping"] === false) parts.push("relative");
  const grid = bp["snap-to-grid"];
  if (grid) parts.push(`grid ${grid.x}×${grid.y}`);
  const offset = bp["position-relative-to-grid"];
  if (offset) parts.push(`offset ${offset.x},${offset.y}`);
  return parts.length > 0 ? parts.join(" · ") : "None";
};

export const countEntitiesByName = (
  entities: BlueprintEntity[] | undefined,
): {
  name: string;
  count: number;
}[] => {
  const counts = new Map<string, number>();
  for (const entity of entities ?? []) {
    counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export const encodedByteSize = (blueprint: Blueprint): number => {
  return encode({ blueprint }).length;
};

export const encodedBookByteSize = (book: BlueprintBook): number => {
  return encode({ blueprint_book: book }).length;
};

export const formatByteSize = (bytes: number): string => {
  return `${(bytes / 1024).toFixed(2)} KB`;
};

export const formatContents = (entities: BlueprintEntity[] | undefined): string => {
  const counts = countEntitiesByName(entities);
  if (counts.length === 0) return "none";
  return counts.map(({ name, count }) => `${name} ×${count}`).join(", ");
};
