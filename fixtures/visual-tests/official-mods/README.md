# Official-mod visual test books

This directory contains the Factorio 2.1.11 test books for placeable prototypes added by the
official mods. Each emitted mod gets its own committed blueprint file rather than a composed root
book. The suite deliberately complements rather than duplicates the Base book:

- Elevated Rails owns 6 entity prototypes with every available direction pose.
- Quality owns a separate zero-placement spec because it adds no placeable entity or tile.
- Recycler owns 1 entity prototype with every available direction pose.
- Space Age owns 27 entity prototypes with every available direction pose and 7 tile patches.

Each mod's inventory and hierarchy live in its own `tools/corpus/src/*-book-spec.ts` file.
`official-mod-book-specs.ts` defines the exact composition order, and `official-mod-suite.ts`
builds one book per official mod plus the shared manifest using the exact profile `[base,
elevated-rails, quality, recycler, space-age]`. Books are ordered base, then space age, quality,
elevated rails, and recycler in the Viewer and manifest. Every entity gets every available
direction and underground/loader input-output pose; every tile gets one 7×7 patch. Connectivity,
runtime state, recipes, modules, filters, circuits, quality states, and surface-specific placement
are intentionally deferred.

Regenerate and validate the workflow with:

```bash
pnpm visual-tests:generate:official
pnpm -F @fpsr/corpus test
pnpm visual-tests:official:audit
```

The audit expects Factorio 2.1.11, `assets-out/2.1.11`, and locally captured references. Capture
the four manifest-selected canary pages or all six pages with:

```bash
pnpm visual-tests:official:canary
pnpm visual-tests:official:all
```

Renderer behavior is not a generation gate. If planning an individual entity fails, generation
falls back to its selection box for layout and records the issue under `rendererDiagnostics` in
`manifest.json`; renderer fixes belong to a separate task.
