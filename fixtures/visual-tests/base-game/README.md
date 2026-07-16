# Base game visual test book

`book.bp.txt` is the generated, nested Factorio 2.1.11 Base-game book shown in the Viewer's
**Tests** section. `manifest.json` addresses every page and test cell. The ground-truth runner
extracts leaf blueprints, captures one whole page per game shot, and crops stable per-case diffs
without depending on page layout conventions or launching once per entity.

Regenerate both files with:

```sh
pnpm -F @fpsr/corpus run generate:base
```

The inventory is owned by the curated Base 2.1.11 catalog in
`tools/corpus/src/base-game-catalog.ts`. The catalog contains 109 entity prototypes (including
hidden/internal and legacy entities) and eight tiles. `base-profile.ts` contains the data.raw
discovery/audit rule used for normal Base entities; the two legacy rail prototypes are explicit
catalog additions.

Each page contains at most 12 cases. Cases are packed from their actual pose-specific rendered
sprite bounds, excluding shadows, with one empty tile between neighbors. The manifest crop gives
each case half of that gap on every side. This keeps tall entities such as electric poles readable
without letting long shadows inflate the page. Every book level and leaf blueprint has descriptive
item icons for navigation.

The committed `fixtures/render-db/2.1.11-base.json` was generated with only the `base` mod enabled.
The generator rejects any other game version or mod profile, so inventory, pose metadata, renderer
assets, and real-game captures all share the same exact profile. Real-game PNG references remain
local and ignored; CI can still check deterministic generation, book addressing, matrix coverage,
and renderer planning without a Factorio installation.

## Real-render runner

```bash
# Report runtime, asset-profile, and stale/missing-reference blockers together.
pnpm visual-tests:audit

# With an exact Factorio 2.1.11 installation, build the required Base-only assets.
pnpm assets:build:base -- --factorio /path/to/factorio-2.1.11.app

# Capture + compare five deterministic pages (direction/orientation/mask/belt/tile).
pnpm visual-tests:canary

# Capture + compare all 166 pages in batches of eight game shots.
pnpm visual-tests:all
```

Game references live under ignored `fixtures/ground-truth/base-game-2.1.11/ppt-64/`. The index binds
each PNG to its leaf-blueprint hash, manifest path, exact camera frame, Factorio/mod profile, and PNG
checksum, so stale references fail before pixel comparison. Comparison reports and only failing
cell/page images are written under `build/visual-tests/base-game-2.1.11/ppt-64/`.
