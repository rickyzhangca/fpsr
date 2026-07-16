import { ELEVATED_RAILS_BOOK_SPEC } from "./elevated-rails-book-spec.js";
import type { FactorioModBookSpec } from "./mod-book-spec.js";
import { QUALITY_BOOK_SPEC } from "./quality-book-spec.js";
import { RECYCLER_BOOK_SPEC } from "./recycler-book-spec.js";
import { SPACE_AGE_BOOK_SPEC } from "./space-age-book-spec.js";

export const OFFICIAL_MOD_PROFILE = [
  "base",
  "elevated-rails",
  "quality",
  "recycler",
  "space-age",
] as const;

export const OFFICIAL_MOD_BOOK_SPECS = [
  SPACE_AGE_BOOK_SPEC,
  QUALITY_BOOK_SPEC,
  ELEVATED_RAILS_BOOK_SPEC,
  RECYCLER_BOOK_SPEC,
] as const satisfies readonly FactorioModBookSpec[];
