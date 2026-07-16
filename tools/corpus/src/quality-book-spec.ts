import type { FactorioModBookSpec } from "./mod-book-spec.js";

/** Quality owns no placeable entity or tile; icon/quality-state coverage is intentionally deferred. */
export const QUALITY_BOOK_SPEC = {
  kind: "book",
  mod: "quality",
  gameVersion: "2.1.11",
  id: "quality-2.1.11",
  label: "quality items 2.1.11",
  icons: ["quality-module"],
  children: [],
} as const satisfies FactorioModBookSpec;
