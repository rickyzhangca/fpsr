import { filledBlueprintIcons } from "./blueprint-icons.js";
import { deconstructionPlannerIcons } from "./deconstruction-planner.js";
import type {
  Blueprint,
  BlueprintBook,
  BlueprintBookEntry,
  BlueprintDocument,
  BlueprintRef,
  Icon,
} from "./types/blueprint.js";
import { upgradePlannerIcons } from "./upgrade-planner.js";

export type BlueprintSelectReason = "not-found" | "planner" | "empty-book";

export class BlueprintSelectError extends Error {
  readonly reason: BlueprintSelectReason;

  constructor(reason: BlueprintSelectReason, message?: string) {
    super(message ?? reason);
    this.name = "BlueprintSelectError";
    this.reason = reason;
  }
}

function isPlannerEntry(entry: BlueprintBookEntry): boolean {
  return entry.upgrade_planner !== undefined || entry.deconstruction_planner !== undefined;
}

function flattenBook(
  book: BlueprintBook,
  pathPrefix: number[],
  depth: number,
  out: BlueprintRef[],
): void {
  const entries = book.blueprints ?? [];
  for (const entry of entries) {
    const entryPath = [...pathPrefix, entry.index];

    if (entry.blueprint) {
      out.push({
        path: entryPath,
        label: entry.blueprint.label,
        depth,
      });
    }

    if (entry.blueprint_book) {
      flattenBook(entry.blueprint_book, entryPath, depth + 1, out);
    }

    // upgrade_planner and deconstruction_planner entries are skipped
  }
}

/**
 * Depth-first flatten of all renderable blueprints inside a (possibly nested) book.
 * Root bare blueprints get path [].
 */
export function listBlueprints(doc: BlueprintDocument): BlueprintRef[] {
  if (doc.blueprint) {
    return [{ path: [], label: doc.blueprint.label, depth: 0 }];
  }

  if (doc.blueprint_book) {
    const out: BlueprintRef[] = [];
    flattenBook(doc.blueprint_book, [], 0, out);
    return out;
  }

  return [];
}

function findEntryByIndex(book: BlueprintBook, index: number): BlueprintBookEntry | undefined {
  return (book.blueprints ?? []).find((e) => e.index === index);
}

function selectFromBook(book: BlueprintBook, path: number[]): Blueprint {
  if (path.length === 0) {
    const active = book.active_index ?? 0;
    const entry = findEntryByIndex(book, active);
    if (!entry) {
      throw new BlueprintSelectError("not-found", `No book entry at active_index ${active}`);
    }
    if (isPlannerEntry(entry)) {
      throw new BlueprintSelectError("planner", "Active entry is a planner");
    }
    if (entry.blueprint) {
      return entry.blueprint;
    }
    if (entry.blueprint_book) {
      return selectFromBook(entry.blueprint_book, []);
    }
    throw new BlueprintSelectError("empty-book", "Active entry has no blueprint or book");
  }

  const head = path[0];
  if (head === undefined) {
    throw new BlueprintSelectError("not-found", "Empty path");
  }
  const rest = path.slice(1);
  const entry = findEntryByIndex(book, head);
  if (!entry) {
    throw new BlueprintSelectError("not-found", `No book entry at index ${head}`);
  }
  if (isPlannerEntry(entry)) {
    throw new BlueprintSelectError("planner", `Entry at index ${head} is a planner`);
  }
  if (rest.length === 0) {
    if (entry.blueprint) {
      return entry.blueprint;
    }
    throw new BlueprintSelectError("not-found", `Entry at index ${head} is not a blueprint`);
  }
  if (entry.blueprint_book) {
    return selectFromBook(entry.blueprint_book, rest);
  }
  throw new BlueprintSelectError("not-found", `Entry at index ${head} has no nested book`);
}

/**
 * Select a blueprint from a document. Without path, follows active_index through nested books.
 */
export function selectBlueprint(doc: BlueprintDocument, path?: number[]): Blueprint {
  if (doc.blueprint) {
    if (path !== undefined && path.length > 0) {
      throw new BlueprintSelectError("not-found", "Cannot use path on a bare blueprint document");
    }
    return doc.blueprint;
  }

  if (doc.blueprint_book) {
    return selectFromBook(doc.blueprint_book, path ?? []);
  }

  throw new BlueprintSelectError("not-found", "Document has no blueprint or blueprint book");
}

function selectBookFromBook(book: BlueprintBook, path: number[]): BlueprintBook {
  if (path.length === 0) {
    return book;
  }

  const head = path[0];
  if (head === undefined) {
    throw new BlueprintSelectError("not-found", "Empty path");
  }
  const rest = path.slice(1);
  const entry = findEntryByIndex(book, head);
  if (!entry) {
    throw new BlueprintSelectError("not-found", `No book entry at index ${head}`);
  }
  if (isPlannerEntry(entry)) {
    throw new BlueprintSelectError("planner", `Entry at index ${head} is a planner`);
  }
  if (!entry.blueprint_book) {
    throw new BlueprintSelectError("not-found", `Entry at index ${head} is not a blueprint book`);
  }
  return selectBookFromBook(entry.blueprint_book, rest);
}

/**
 * Select a blueprint book from a document by path.
 * No path / `[]` returns the root book; non-empty paths walk nested books only.
 */
export function selectBook(doc: BlueprintDocument, path?: number[]): BlueprintBook {
  if (!doc.blueprint_book) {
    throw new BlueprintSelectError("not-found", "Document has no blueprint book");
  }
  return selectBookFromBook(doc.blueprint_book, path ?? []);
}

function selectUpgradePlannerFromBook(
  book: BlueprintBook,
  path: number[],
): Record<string, unknown> {
  if (path.length === 0) {
    throw new BlueprintSelectError("not-found", "Path required to select an upgrade planner");
  }
  const head = path[0];
  if (head === undefined) {
    throw new BlueprintSelectError("not-found", "Empty path");
  }
  const rest = path.slice(1);
  const entry = findEntryByIndex(book, head);
  if (!entry) {
    throw new BlueprintSelectError("not-found", `No book entry at index ${head}`);
  }
  if (rest.length === 0) {
    if (entry.upgrade_planner) {
      return entry.upgrade_planner;
    }
    throw new BlueprintSelectError(
      entry.deconstruction_planner ? "planner" : "not-found",
      `Entry at index ${head} is not an upgrade planner`,
    );
  }
  if (entry.blueprint_book) {
    return selectUpgradePlannerFromBook(entry.blueprint_book, rest);
  }
  throw new BlueprintSelectError("not-found", `Entry at index ${head} has no nested book`);
}

/**
 * Select an upgrade planner from a document.
 * Bare upgrade-planner documents ignore path (or require `[]`).
 * Book documents require a path ending on an `upgrade_planner` entry.
 */
export function selectUpgradePlanner(
  doc: BlueprintDocument,
  path?: number[],
): Record<string, unknown> {
  if (doc.upgrade_planner) {
    if (path !== undefined && path.length > 0) {
      throw new BlueprintSelectError(
        "not-found",
        "Cannot use path on a bare upgrade planner document",
      );
    }
    return doc.upgrade_planner;
  }

  if (doc.blueprint_book) {
    if (path === undefined || path.length === 0) {
      throw new BlueprintSelectError("not-found", "Path required to select an upgrade planner");
    }
    return selectUpgradePlannerFromBook(doc.blueprint_book, path);
  }

  throw new BlueprintSelectError("not-found", "Document has no upgrade planner");
}

function selectDeconstructionPlannerFromBook(
  book: BlueprintBook,
  path: number[],
): Record<string, unknown> {
  if (path.length === 0) {
    throw new BlueprintSelectError("not-found", "Path required to select a deconstruction planner");
  }
  const head = path[0];
  if (head === undefined) {
    throw new BlueprintSelectError("not-found", "Empty path");
  }
  const rest = path.slice(1);
  const entry = findEntryByIndex(book, head);
  if (!entry) {
    throw new BlueprintSelectError("not-found", `No book entry at index ${head}`);
  }
  if (rest.length === 0) {
    if (entry.deconstruction_planner) {
      return entry.deconstruction_planner;
    }
    throw new BlueprintSelectError(
      entry.upgrade_planner ? "planner" : "not-found",
      `Entry at index ${head} is not a deconstruction planner`,
    );
  }
  if (entry.blueprint_book) {
    return selectDeconstructionPlannerFromBook(entry.blueprint_book, rest);
  }
  throw new BlueprintSelectError("not-found", `Entry at index ${head} has no nested book`);
}

/**
 * Select a deconstruction planner from a document.
 * Bare deconstruction-planner documents ignore path (or require `[]`).
 * Book documents require a path ending on a `deconstruction_planner` entry.
 */
export function selectDeconstructionPlanner(
  doc: BlueprintDocument,
  path?: number[],
): Record<string, unknown> {
  if (doc.deconstruction_planner) {
    if (path !== undefined && path.length > 0) {
      throw new BlueprintSelectError(
        "not-found",
        "Cannot use path on a bare deconstruction planner document",
      );
    }
    return doc.deconstruction_planner;
  }

  if (doc.blueprint_book) {
    if (path === undefined || path.length === 0) {
      throw new BlueprintSelectError(
        "not-found",
        "Path required to select a deconstruction planner",
      );
    }
    return selectDeconstructionPlannerFromBook(doc.blueprint_book, path);
  }

  throw new BlueprintSelectError("not-found", "Document has no deconstruction planner");
}

export type BookTreeItemKind = "book" | "blueprint" | "upgrade_planner" | "deconstruction_planner";

/** Hierarchical book entry for tree UIs (e.g. Headless Tree sync data loader). */
export interface BookTreeItem {
  id: string;
  path: number[];
  label: string;
  kind: BookTreeItemKind;
  icons?: Icon[];
  /**
   * When set on a book node, nest a planner composite (this paper + `icons`) as
   * the single icon on the book cover — does not replace the book paper.
   */
  iconBackgroundKey?: string;
  children: string[];
}

export interface BookTree {
  rootId: string;
  items: Record<string, BookTreeItem>;
}

const ROOT_ID = "root";

function pathToId(path: number[]): string {
  return path.length === 0 ? ROOT_ID : path.join(".");
}

function entryKind(entry: BlueprintBookEntry): BookTreeItemKind | null {
  if (entry.blueprint_book) return "book";
  if (entry.blueprint) return "blueprint";
  if (entry.upgrade_planner) return "upgrade_planner";
  if (entry.deconstruction_planner) return "deconstruction_planner";
  return null;
}

function plannerField(planner: Record<string, unknown> | undefined, key: string): unknown {
  return planner?.[key];
}

function entryLabel(entry: BlueprintBookEntry, kind: BookTreeItemKind): string {
  if (kind === "book") return entry.blueprint_book?.label ?? "(untitled)";
  if (kind === "blueprint") return entry.blueprint?.label ?? "(untitled)";
  if (kind === "upgrade_planner") {
    const label = plannerField(entry.upgrade_planner, "label");
    return typeof label === "string" && label.length > 0 ? label : "Upgrade planner";
  }
  const label = plannerField(entry.deconstruction_planner, "label");
  return typeof label === "string" && label.length > 0 ? label : "Deconstruction planner";
}

function entryIcons(entry: BlueprintBookEntry, kind: BookTreeItemKind): Icon[] | undefined {
  if (kind === "book" && entry.blueprint_book) {
    const icons = blueprintBookCover(entry.blueprint_book).icons;
    return icons.length > 0 ? icons : undefined;
  }
  if (kind === "blueprint") return entry.blueprint?.icons;
  if (kind === "upgrade_planner" && entry.upgrade_planner) {
    const icons = upgradePlannerIcons(entry.upgrade_planner);
    return icons.length > 0 ? icons : undefined;
  }
  if (kind === "deconstruction_planner" && entry.deconstruction_planner) {
    const icons = deconstructionPlannerIcons(entry.deconstruction_planner);
    return icons.length > 0 ? icons : undefined;
  }
  return undefined;
}

const BOOK_COVER_BACKGROUND = "item/blueprint-book";

/** Nested planner thumbnail drawn as the single icon on a book cover. */
export interface BlueprintBookCoverNested {
  backgroundKey: string;
  icons: Icon[];
}

/** Inventory thumbnail for a blueprint book: book paper plus cover contents. */
export interface BlueprintBookCover {
  /** Always the book paper; planner composites nest inside via `nested`. */
  backgroundKey: string;
  /** Flat signal icons when the first leaf is a blueprint (or empty). */
  icons: Icon[];
  /**
   * When the first leaf is a planner, its full composite (planner paper + icons)
   * is drawn as the single icon on the book cover.
   */
  nested?: BlueprintBookCoverNested;
}

/**
 * Inventory thumbnail for a blueprint book: always the composite of the first
 * child entry (lowest `index`), including nested books and planners.
 * Ignores any explicit `book.icons` so the cover tracks book contents.
 *
 * The outer paper is always the book. Planner leaves nest their composite as
 * the cover icon; blueprint leaves place signal icons directly on the book.
 */
export function blueprintBookCover(book: BlueprintBook): BlueprintBookCover {
  const entries = [...(book.blueprints ?? [])].sort((a, b) => a.index - b.index);
  const first = entries[0];
  if (!first) return { icons: [], backgroundKey: BOOK_COVER_BACKGROUND };

  if (first.blueprint) {
    return {
      icons: filledBlueprintIcons(first.blueprint.icons),
      backgroundKey: BOOK_COVER_BACKGROUND,
    };
  }
  if (first.upgrade_planner) {
    return {
      icons: [],
      backgroundKey: BOOK_COVER_BACKGROUND,
      nested: {
        backgroundKey: "item/upgrade-planner",
        icons: upgradePlannerIcons(first.upgrade_planner),
      },
    };
  }
  if (first.deconstruction_planner) {
    return {
      icons: [],
      backgroundKey: BOOK_COVER_BACKGROUND,
      nested: {
        backgroundKey: "item/deconstruction-planner",
        icons: deconstructionPlannerIcons(first.deconstruction_planner),
      },
    };
  }
  if (first.blueprint_book) return blueprintBookCover(first.blueprint_book);
  return { icons: [], backgroundKey: BOOK_COVER_BACKGROUND };
}

/** Signal icons for a book cover (nested planner icons when applicable). */
export function blueprintBookCoverIcons(book: BlueprintBook): Icon[] {
  const cover = blueprintBookCover(book);
  return cover.nested?.icons ?? cover.icons;
}

function bookCoverFields(book: BlueprintBook): Pick<BookTreeItem, "icons" | "iconBackgroundKey"> {
  const cover = blueprintBookCover(book);
  if (cover.nested) {
    return {
      ...(cover.nested.icons.length > 0 ? { icons: cover.nested.icons } : {}),
      iconBackgroundKey: cover.nested.backgroundKey,
    };
  }
  return cover.icons.length > 0 ? { icons: cover.icons } : {};
}

function addBookEntries(
  book: BlueprintBook,
  pathPrefix: number[],
  items: Record<string, BookTreeItem>,
): string[] {
  const childIds: string[] = [];
  for (const entry of book.blueprints ?? []) {
    const kind = entryKind(entry);
    if (!kind) continue;

    const entryPath = [...pathPrefix, entry.index];
    const id = pathToId(entryPath);
    childIds.push(id);

    const icons = entryIcons(entry, kind);

    if (kind === "book" && entry.blueprint_book) {
      const nestedChildren = addBookEntries(entry.blueprint_book, entryPath, items);
      items[id] = {
        id,
        path: entryPath,
        label: entryLabel(entry, kind),
        kind,
        ...bookCoverFields(entry.blueprint_book),
        children: nestedChildren,
      };
    } else {
      items[id] = {
        id,
        path: entryPath,
        label: entryLabel(entry, kind),
        kind,
        icons,
        children: [],
      };
    }
  }
  return childIds;
}

/**
 * Build a flat id→item map of the book hierarchy for tree UIs.
 * Returns null when the document is not a blueprint book.
 */
export function buildBookTree(doc: BlueprintDocument): BookTree | null {
  if (!doc.blueprint_book) return null;

  const items: Record<string, BookTreeItem> = {};
  const children = addBookEntries(doc.blueprint_book, [], items);
  items[ROOT_ID] = {
    id: ROOT_ID,
    path: [],
    label: doc.blueprint_book.label ?? "(untitled)",
    kind: "book",
    ...bookCoverFields(doc.blueprint_book),
    children,
  };

  return { rootId: ROOT_ID, items };
}

function resolveActivePathFromBook(book: BlueprintBook, pathPrefix: number[]): number[] {
  const active = book.active_index ?? 0;
  const entry = findEntryByIndex(book, active);
  if (!entry) {
    throw new BlueprintSelectError("not-found", `No book entry at active_index ${active}`);
  }
  const entryPath = [...pathPrefix, entry.index];
  if (entry.upgrade_planner) {
    return entryPath;
  }
  if (entry.deconstruction_planner) {
    return entryPath;
  }
  if (entry.blueprint) {
    return entryPath;
  }
  if (entry.blueprint_book) {
    return resolveActivePathFromBook(entry.blueprint_book, entryPath);
  }
  throw new BlueprintSelectError("empty-book", "Active entry has no blueprint or book");
}

/**
 * Resolve the concrete blueprint path by following active_index through nested books.
 * Bare blueprint documents return []. Returns null when no active blueprint can be resolved.
 */
export function resolveActivePath(doc: BlueprintDocument): number[] | null {
  if (doc.blueprint) return [];
  if (!doc.blueprint_book) return null;
  try {
    return resolveActivePathFromBook(doc.blueprint_book, []);
  } catch {
    return null;
  }
}
