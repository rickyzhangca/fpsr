import type { FactorioModBookSpec } from "./mod-book-spec.js";

export const RECYCLER_BOOK_SPEC = {
  kind: "book",
  mod: "recycler",
  gameVersion: "2.1.11",
  id: "recycler-2.1.11",
  label: "recycler items 2.1.11",
  icons: ["recycler"],
  children: [
    {
      kind: "page",
      id: "official-mods/recycler/recycler",
      label: "production items",
      icons: ["recycler"],
      entities: ["recycler"],
    },
  ],
} as const satisfies FactorioModBookSpec;
