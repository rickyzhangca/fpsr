import type { SidebarSelectableKind, SidebarSource } from "@/sidebar/sidebar-tree";
import {
  type Blueprint,
  type BlueprintBook,
  type BlueprintDocument,
  type DecodeStats,
  decodeWithStats,
  resolveActivePath,
  selectBlueprint,
  selectBook,
  selectDeconstructionPlanner,
  selectUpgradePlanner,
} from "fpsr";
import esnSqueegeeBp from "../../../../fixtures/demos/esn-squeegee.bp.txt?raw";
import nauvisMidGameBp from "../../../../fixtures/demos/nauvis-mid-game.bp.txt?raw";
import redrumBookBp from "../../../../fixtures/demos/redrum-book.bp.txt?raw";
import untraMegabaseBp from "../../../../fixtures/demos/untra-megabase.bp.txt?raw";
import upgradesDowngradesBp from "../../../../fixtures/demos/upgrades-downgrades.bp.txt?raw";
import baseGameTestsBp from "../../../../fixtures/visual-tests/base-game/book.bp.txt?raw";
import elevatedRailsTestsBp from "../../../../fixtures/visual-tests/official-mods/elevated-rails.bp.txt?raw";
import qualityTestsBp from "../../../../fixtures/visual-tests/official-mods/quality.bp.txt?raw";
import recyclerTestsBp from "../../../../fixtures/visual-tests/official-mods/recycler.bp.txt?raw";
import spaceAgeTestsBp from "../../../../fixtures/visual-tests/official-mods/space-age.bp.txt?raw";
import type { LastView } from "./last-view";
import { readLastView } from "./last-view";

const SAMPLES = [
  { id: "untra-megabase", value: untraMegabaseBp.trim() },
  { id: "esn-squeegee", value: esnSqueegeeBp.trim() },
  { id: "nauvis-mid-game", value: nauvisMidGameBp.trim() },
  { id: "redrum-book", value: redrumBookBp.trim() },
  { id: "upgrades-downgrades", value: upgradesDowngradesBp.trim() },
] as const;

const TEST_BOOKS = [
  { id: "tests-base-game-2.1.11", value: baseGameTestsBp.trim() },
  { id: "tests-space-age-2.1.11", value: spaceAgeTestsBp.trim() },
  { id: "tests-quality-2.1.11", value: qualityTestsBp.trim() },
  { id: "tests-elevated-rails-2.1.11", value: elevatedRailsTestsBp.trim() },
  { id: "tests-recycler-2.1.11", value: recyclerTestsBp.trim() },
] as const;

export const DEFAULT_SAMPLE = SAMPLES[0];

interface BuiltInSidebarSource extends SidebarSource {
  stats: DecodeStats;
}

export const tryDecode = (
  source: string,
): {
  doc: BlueprintDocument;
  stats: DecodeStats;
} | null => {
  try {
    return decodeWithStats(source);
  } catch {
    return null;
  }
};

export const sourceLabel = (doc: BlueprintDocument, fallback: string): string => {
  if (doc.blueprint?.label) return doc.blueprint.label;
  if (doc.blueprint_book?.label) return doc.blueprint_book.label;
  if (typeof doc.upgrade_planner?.label === "string" && doc.upgrade_planner.label.length > 0) {
    return doc.upgrade_planner.label;
  }
  if (doc.upgrade_planner) return "Upgrade planner";
  if (
    typeof doc.deconstruction_planner?.label === "string" &&
    doc.deconstruction_planner.label.length > 0
  ) {
    return doc.deconstruction_planner.label;
  }
  if (doc.deconstruction_planner) return "Deconstruction planner";
  return fallback;
};

export const resolveSelectedBook = (
  doc: BlueprintDocument | null,
  path: number[] | null,
  kind: SidebarSelectableKind,
): BlueprintBook | null => {
  if (!doc || kind !== "book") return null;
  try {
    return selectBook(doc, path ?? undefined);
  } catch {
    return null;
  }
};

export const resolveSelectedBlueprint = (
  doc: BlueprintDocument | null,
  path: number[] | null,
  kind: SidebarSelectableKind,
): Blueprint | null => {
  if (!doc || kind !== "blueprint") return null;
  try {
    if (doc.blueprint) return doc.blueprint;
    return doc.blueprint_book ? selectBlueprint(doc, path ?? undefined) : null;
  } catch {
    return null;
  }
};

export const resolveSelectedUpgradePlanner = (
  doc: BlueprintDocument | null,
  path: number[] | null,
  kind: SidebarSelectableKind,
): Record<string, unknown> | null => {
  if (!doc || kind !== "upgrade_planner") return null;
  try {
    return selectUpgradePlanner(doc, path ?? undefined);
  } catch {
    return null;
  }
};

export const resolveSelectedDeconstructionPlanner = (
  doc: BlueprintDocument | null,
  path: number[] | null,
  kind: SidebarSelectableKind,
): Record<string, unknown> | null => {
  if (!doc || kind !== "deconstruction_planner") return null;
  try {
    return selectDeconstructionPlanner(doc, path ?? undefined);
  } catch {
    return null;
  }
};

/** Initial selection after pasting/opening a decoded document. */
export const selectionForDoc = (
  doc: BlueprintDocument,
): {
  path: number[] | null;
  kind: SidebarSelectableKind;
} => {
  if (doc.upgrade_planner) {
    return { path: null, kind: "upgrade_planner" };
  }
  if (doc.deconstruction_planner) {
    return { path: null, kind: "deconstruction_planner" };
  }
  if (doc.blueprint_book) {
    const path = resolveActivePath(doc);
    if (!path) return { path: null, kind: "book" };
    try {
      selectUpgradePlanner(doc, path);
      return { path, kind: "upgrade_planner" };
    } catch {
      try {
        selectDeconstructionPlanner(doc, path);
        return { path, kind: "deconstruction_planner" };
      } catch {
        try {
          selectBlueprint(doc, path);
          return { path, kind: "blueprint" };
        } catch {
          return { path: null, kind: "book" };
        }
      }
    }
  }
  return { path: resolveActivePath(doc), kind: "blueprint" };
};

const decodeBuiltInSources = (
  sources: readonly { id: string; value: string }[],
): BuiltInSidebarSource[] => {
  return sources.flatMap((source) => {
    const decoded = tryDecode(source.value);
    return decoded
      ? [
          {
            id: source.id,
            label: sourceLabel(decoded.doc, ""),
            doc: decoded.doc,
            raw: source.value,
            stats: decoded.stats,
          },
        ]
      : [];
  });
};

export const SAMPLE_SOURCES = decodeBuiltInSources(SAMPLES);
export const TEST_SOURCES = decodeBuiltInSources(TEST_BOOKS);

export const BUILT_IN_SOURCE_BY_ID = new Map(
  [...SAMPLE_SOURCES, ...TEST_SOURCES].map((source) => [source.id, source]),
);

export const BUILT_IN_DECODE_STATS = Object.fromEntries(
  [...SAMPLE_SOURCES, ...TEST_SOURCES].map((source) => [source.id, source.stats]),
) as Record<string, DecodeStats>;

export const resolveStoredSelection = (
  doc: BlueprintDocument,
  path: number[] | null,
  kind: SidebarSelectableKind,
): {
  path: number[] | null;
  kind: SidebarSelectableKind;
} => {
  if (kind === "book") {
    if (!doc.blueprint_book) {
      if (doc.upgrade_planner) return { path: null, kind: "upgrade_planner" };
      if (doc.deconstruction_planner) return { path: null, kind: "deconstruction_planner" };
      return { path: resolveActivePath(doc), kind: "blueprint" };
    }
    try {
      selectBook(doc, path ?? undefined);
      return { path, kind: "book" };
    } catch {
      return { path: null, kind: "book" };
    }
  }
  if (kind === "upgrade_planner") {
    try {
      selectUpgradePlanner(doc, path ?? undefined);
      return { path, kind: "upgrade_planner" };
    } catch {
      if (doc.upgrade_planner) return { path: null, kind: "upgrade_planner" };
      return selectionForDoc(doc);
    }
  }
  if (kind === "deconstruction_planner") {
    try {
      selectDeconstructionPlanner(doc, path ?? undefined);
      return { path, kind: "deconstruction_planner" };
    } catch {
      if (doc.deconstruction_planner) return { path: null, kind: "deconstruction_planner" };
      return selectionForDoc(doc);
    }
  }
  if (doc.upgrade_planner && !doc.blueprint && !doc.blueprint_book) {
    return { path: null, kind: "upgrade_planner" };
  }
  if (doc.deconstruction_planner && !doc.blueprint && !doc.blueprint_book) {
    return { path: null, kind: "deconstruction_planner" };
  }
  if (!doc.blueprint_book) return { path: null, kind: "blueprint" };
  try {
    selectBlueprint(doc, path ?? undefined);
    return { path, kind: "blueprint" };
  } catch {
    return { path: resolveActivePath(doc), kind: "blueprint" };
  }
};

export const initialSelection = (): LastView => {
  const last = readLastView();
  if (last) {
    const builtIn = BUILT_IN_SOURCE_BY_ID.get(last.sourceId);
    if (builtIn) {
      const resolved = resolveStoredSelection(builtIn.doc, last.path, last.kind);
      return { sourceId: builtIn.id, ...resolved };
    }
  }
  return { sourceId: DEFAULT_SAMPLE.id, path: null, kind: "blueprint" };
};
