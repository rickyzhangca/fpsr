export interface BookSpec {
  kind: "book";
  id: string;
  label: string;
  icons: readonly string[];
  children: readonly BookEntrySpec[];
}

export interface PageSpec {
  kind: "page";
  id: string;
  label: string;
  icons: readonly string[];
  entities?: readonly string[];
  tiles?: readonly string[];
}

export type BookEntrySpec = BookSpec | PageSpec;

/** Inventory and Viewer hierarchy owned by one Factorio mod. */
export interface FactorioModBookSpec extends BookSpec {
  mod: string;
  gameVersion: string;
}

export function pagesInBook(entry: BookEntrySpec): PageSpec[] {
  if (entry.kind === "page") return [entry];
  return entry.children.flatMap(pagesInBook);
}

export function entityNamesInBook(entry: BookEntrySpec): string[] {
  return pagesInBook(entry).flatMap((page) => [...(page.entities ?? [])]);
}

export function tileNamesInBook(entry: BookEntrySpec): string[] {
  return pagesInBook(entry).flatMap((page) => [...(page.tiles ?? [])]);
}

export function pageInBook(entry: BookEntrySpec, id: string): PageSpec {
  const page = pagesInBook(entry).find((candidate) => candidate.id === id);
  if (!page) throw new Error(`Unknown book page: ${id}`);
  return page;
}

export function rootBookIn(entry: FactorioModBookSpec, id: string): BookSpec {
  const child = entry.children.find(
    (candidate) => candidate.kind === "book" && candidate.id === id,
  );
  if (!child || child.kind !== "book") throw new Error(`Unknown root book: ${id}`);
  return child;
}

export function validateModBookSpec(spec: FactorioModBookSpec): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const entityNames = new Set<string>();
  const tileNames = new Set<string>();

  const visit = (entry: BookEntrySpec): void => {
    if (ids.has(entry.id)) issues.push(`duplicate entry id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.icons.length === 0) issues.push(`entry has no icons: ${entry.id}`);
    if (entry.icons.length > 4) issues.push(`entry has more than four icons: ${entry.id}`);
    if (entry.kind === "book") {
      for (const child of entry.children) visit(child);
      return;
    }
    if ((entry.entities?.length ?? 0) === 0 && (entry.tiles?.length ?? 0) === 0) {
      issues.push(`page has no entities or tiles: ${entry.id}`);
    }
    for (const name of entry.entities ?? []) {
      if (entityNames.has(name)) issues.push(`duplicate entity: ${name}`);
      entityNames.add(name);
    }
    for (const name of entry.tiles ?? []) {
      if (tileNames.has(name)) issues.push(`duplicate tile: ${name}`);
      tileNames.add(name);
    }
  };

  visit(spec);
  return issues;
}
