import type { FactorioModBookSpec } from "./mod-book-spec.js";

export const ELEVATED_RAILS_BOOK_SPEC = {
  kind: "book",
  mod: "elevated-rails",
  gameVersion: "2.1.11",
  id: "elevated-rails-2.1.11",
  label: "elevated rails items 2.1.11",
  icons: ["rail-ramp", "rail-support"],
  children: [
    {
      kind: "page",
      id: "official-mods/elevated-rails/logistics",
      label: "logistics",
      icons: ["rail-ramp", "rail-support"],
      entities: [
        "elevated-straight-rail",
        "elevated-half-diagonal-rail",
        "elevated-curved-rail-a",
        "elevated-curved-rail-b",
        "rail-ramp",
        "rail-support",
      ],
    },
  ],
} as const satisfies FactorioModBookSpec;
