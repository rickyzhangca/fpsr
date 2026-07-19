import type {
  Blueprint,
  BlueprintDocument,
  BlueprintEntity,
  Icon,
  Position,
  RenderDb,
} from "@rickyzhangca/fpsr";
import { BASE_GAME_BOOK_SPEC, BASE_GAME_VERSION } from "../base-game-book-spec.js";
import type { EntityPose } from "../entity-poses.js";
import type { SuiteCaseBounds, SuiteLattice, SuitePlacement } from "../suite-layout.js";

export const SIDES = ["north", "east", "south", "west"] as const;
export type Side = (typeof SIDES)[number];
export type BeltNeighborState = "absent" | "inbound" | "outbound";

export type BaseSuiteCaseKind =
  | "entity-pose"
  | "adjacency-mask"
  | "belt-neighborhood"
  | "tile-patch";

export interface BaseSuiteCell {
  id: string;
  caseKind: BaseSuiteCaseKind;
  pageId: string;
  pagePath: number[];
  cropTiles: { left: number; top: number; right: number; bottom: number };
  focusEntityNumbers: number[];
  entityName?: string;
  tileName?: string;
  pose?: EntityPose;
  adjacency?: {
    mask: number;
    sides: Side[];
  };
  beltNeighborhood?: {
    centerDirection: number;
    sides: Record<Side, BeltNeighborState>;
  };
  tilePatch?: { width: number; height: number };
}

export interface BaseSuitePage {
  id: string;
  label: string;
  sectionId: string;
  groupId: string;
  path: number[];
  cellIds: string[];
  entityCount: number;
  tileCount: number;
}

export interface BaseSuiteManifest {
  schema: 1;
  suiteId: "base-game-2.1.11";
  gameVersion: typeof BASE_GAME_VERSION;
  requiredMods: ["base"];
  canaryPageIds: string[];
  inventory: {
    source: "base-game-book-spec";
    specId: typeof BASE_GAME_BOOK_SPEC.id;
    entityCount: number;
    tileCount: number;
  };
  renderMetadata: {
    role: "exact-base-graphics-and-pose-metadata";
    gameVersion: string;
    mods: string[];
    baseOnly: true;
  };
  referenceOracle: {
    status: "local-capture-required";
    reason: string;
  };
  contract: {
    covered: string[];
    deferred: string[];
  };
  coverage: {
    entityPrototypeCount: number;
    entityPoseCaseCount: number;
    adjacencyMaskCaseCount: number;
    beltNeighborhoodCaseCount: number;
    tileCaseCount: number;
    pageCount: number;
  };
  pages: BaseSuitePage[];
  cells: BaseSuiteCell[];
}

export interface BaseSuiteBuild {
  document: BlueprintDocument;
  manifest: BaseSuiteManifest;
}

export interface PlacementContext {
  center: Position;
  entity: (name: string, offset?: Position, fields?: Partial<BlueprintEntity>) => BlueprintEntity;
}

export type CasePlacement = SuitePlacement;

export interface CaseSpec {
  id: string;
  caseKind: BaseSuiteCaseKind;
  entityName?: string;
  tileName?: string;
  pose?: BaseSuiteCell["pose"];
  adjacency?: BaseSuiteCell["adjacency"];
  beltNeighborhood?: BaseSuiteCell["beltNeighborhood"];
  tilePatch?: BaseSuiteCell["tilePatch"];
  place(context: PlacementContext): CasePlacement;
}

export interface PageDraft {
  id: string;
  label: string;
  sectionId: string;
  groupId: string;
  blueprint: Blueprint;
  cells: BaseSuiteCell[];
}

export interface GroupDraft {
  id: string;
  label: string;
  icons: Icon[];
  entries: GroupBookEntry[];
}

export type GroupBookEntry =
  | { kind: "page"; page: PageDraft }
  | { kind: "book"; id: string; label: string; icons: Icon[]; pages: PageDraft[] };

export interface MaterializedCase {
  spec: CaseSpec;
  placement: CasePlacement;
  bounds: SuiteCaseBounds;
  lattice: SuiteLattice;
}

export interface PageBuildBehavior {
  buildCases?: (renderDb: RenderDb) => CaseSpec[];
  buildCaseRows?: (renderDb: RenderDb) => CaseSpec[][];
}
