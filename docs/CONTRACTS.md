# fpsr — Cross-cutting Contracts

This document is the source of truth for the interfaces between the offline pipeline,
the renderer library, the viewer, and the test suites. The companion TypeScript files
are normative:

- `packages/renderer/src/types/blueprint.ts` — decoded blueprint model (Factorio 2.x string format)
- `packages/renderer/src/types/render-db.ts` — the "render database" IR produced by `tools/pipeline`
- `packages/renderer/src/types/draw-list.ts` — the serializable draw-list IR produced by the planner

Breaking changes to the outer shapes require a semver bump and an update to this
document. Additive, backward-compatible extensions of kind-specific payloads in
`render-db.ts` are expected and fine.

## Target

Factorio **2.1.11** exactly, vanilla + Space Age + Elevated Rails + Quality + Recycler
(the six data packages shipped in `/Applications/factorio.app/Contents/data`).

## Rendering pipeline (dataflow)

```
blueprint string
  -> decode()                      packages/renderer/src/decode  (faithful inflate)
  -> BlueprintDocument             types/blueprint.ts
  -> migrateTo2x()                 packages/renderer/src/migrate  (1.x → 2.x; idempotent)
  -> resolve()                     connectivity resolver: pure fn (entities, render-db) -> ResolvedEntity[]
  -> planDrawList()                pure fn (bp, render-db, options) -> DrawList
  -> DrawList                      types/draw-list.ts  <- Tier-2 snapshot surface
  -> Canvas2D backend              executes DrawList against atlas images from an AssetSource
```

`decode` is a faithful inflate/parse (encode round-trips unchanged). `migrateTo2x` /
`migrateDocumentTo2x` convert Factorio 1.x blueprint JSON into 2.x shape; `resolve` and
`planDrawList` call `migrateTo2x` at entry so every library path is safe. After migration,
`version` major is bumped to 2 so re-entry is a no-op.

`decode`, `migrateTo2x`, `resolve`, `planDrawList`, `analyzePlan`, and
`countBlueprintComponents` are pure and synchronous. Only asset loading and canvas
execution are async. Nothing above the backend may touch the DOM, `fetch`, or node APIs.

## Coordinate system

- All draw-list geometry is in **tile units** (floats), in blueprint map coordinates
  (entity `position` is the entity center, y grows downward/south).
- The backend converts tiles to pixels via `pixelsPerTile` (default 64). Game-native
  scale is 32 px/tile at zoom 1; source sprites are high-res with a prototype `scale`
  (usually 0.5), so a sprite's on-map size in tiles is `srcPx * protoScale / 32`.
- `DrawList.bounds` is the tight tile-space bounding box of all commands; the backend
  sizes the canvas from it plus `padTiles`.

## Directions

The renderer assumes **Factorio 2.x** 16-way directions: 0 = north, 4 = east, 8 = south,
12 = west (`defines.direction`). Most entities only occupy the 4 or 8 cardinal slots.
The render-db stores, per entity, a `directionIndex` mapping strategy (see `render-db.ts`)
so the runtime never guesses.

Factorio 1.x directions (0/2/4/6) are converted by the `scale-legacy-directions` adapter
inside [`migrate.ts`](../packages/renderer/src/migrate.ts). Do not re-implement version
forks in resolve/plan.

## Blueprint migration adapters

Registry: `BLUEPRINT_ADAPTERS` in `packages/renderer/src/migrate.ts`. Add new 1.x→2.x
transforms there and document them below.

| Adapter id                | What it fixes                                     | Note                                                                               |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `scale-legacy-directions` | Entity `direction` 0/2/4/6 → 0/4/8/12             | [Wiki](https://wiki.factorio.com/Blueprint_string_format): 2.x dirs are double 1.x |
| `items-object-to-array`   | Entity `items` `{ "mod": n }` → insert-plan array | 1.x module/request map → 2.x `[{ id, items.grid_count }]`                          |

**Future (not implemented):** `connections-neighbours-to-wires`, `rename-logistic-chests`
— add when a real 1.x corpus needs them.

## Layering

Draw order = stable sort by `(layer, sortY, sortX, entityNumber, sub)`:

- `layer`: numeric value from the `RENDER_LAYERS` table in `draw-list.ts`
  (full Factorio `RenderLayer` enum order, plus fpsr-only aliases).
  See [RENDER_LAYERS.md](./RENDER_LAYERS.md) for **official dump/API data vs fpsr guesses**.
- `sortY`: y of the entity's collision-box bottom edge (tile units) for object layers;
  rolling stock (`kind === "train"`) uses `position.y` instead so elongated collision
  boxes don't sort past trackside entities; 0 otherwise.
- `sortX`: entity `position.x` for object layers (west→east when `sortY` ties); 0 otherwise.
- `sub`: intra-entity layer index (order of `LayerGroup`s in the entity's render def).

Shadows are ordinary draw commands on the fpsr `shadow` layer with `drawAsShadow: true`.
The Canvas2D backend flattens overlapping shadows at full opacity in reusable 1024 px
scratch tiles, then composites each occupied tile at 50% opacity. Peak shadow scratch
memory is therefore bounded independently of final output dimensions.

## Public API (packages/renderer)

```ts
// decoding — pure, no assets needed
decode(source: string): BlueprintDocument;              // bp string or raw JSON string
encode(doc: BlueprintDocument): string;                 // for fixtures/corpus generation
migrateTo2x(bp: Blueprint): Blueprint;                  // 1.x → 2.x (idempotent)
migrateDocumentTo2x(doc: BlueprintDocument): BlueprintDocument;
listBlueprints(doc: BlueprintDocument): BlueprintRef[]; // flattened book tree
selectBlueprint(doc: BlueprintDocument, path?: number[]): Blueprint; // default: active_index chain

// planning — pure, needs render-db but no images
planDrawList(bp: Blueprint, db: RenderDb, opts?: PlanOptions): DrawList;
analyzePlan(bp: Blueprint, drawList: DrawList, db: RenderDb): PlanDiagnostics;
countBlueprintComponents(bp: Blueprint, db: RenderDb): BlueprintComponentCount[];

// rendering — async, needs assets
const r = await createRenderer({ assets: AssetSource, renderDb?: RenderDb });
const measurement = r.measure(docOrBp, { blueprintPath?, pixelsPerTile?, maxOutputSize? });
const out = await r.render(docOrBp, { blueprintPath?, pixelsPerTile?, maxOutputSize?, altMode?, background?, showCheckerboard?, showBackgroundAuto?, showSpace?, showSpacePlanet?, spacePlanet?, terrainBackground?, showCoordinates? });
// out: { canvas, width, height, drawList, toPngBlob()/toPngBuffer() }

// asset sources
cdnAssets(baseUrl: string): AssetSource;      // browser+node fetch
localAssets(dir: string): AssetSource;        // node only, subpath export "fpsr/node"
```

`AssetSource` contract:

```ts
interface AssetSource {
  loadRenderDb(): Promise<RenderDb>;
  loadAtlasImage(index: number): Promise<CanvasImageSource>; // ImageBitmap in browser, skia-canvas Image in node
}
```

Amendments ratified during M1 (binding):

- `resolve(bp, db, warningsOut?: string[])` — unknown entities are skipped and reported
  via the optional out-array, never thrown.
- `executeDrawList(ctx, list, images, opts)` requires `opts.frames: FrameMeta[]`
  (trim math needs frame metadata; the DrawList carries only frame ids).
- `PlanOptions.background` is not emitted into the draw list; the backend/renderer
  applies it as a canvas clear.
- `PlanOptions.altMode` emits only blueprint-derived entity info: recipes,
  configured filters/requests/items, static display-panel icons (not circuit
  message parameters), splitter priorities, and quality badges. It does not
  infer live inventories, fluids, furnace state, or mining targets.
- `RenderDb.icons` uses Blueprint `SignalId` namespaces (`item/`, `recipe/`,
  `fluid/`, `virtual-signal/`, `entity/`, `quality/`, `space-location/`, and
  `asteroid-chunk/`) plus internal `utility/` entity-info frames.
- `cdnAssets(baseUrl, options?)` accepts `{ decodeImage, fetchImpl }` for
  environments without `createImageBitmap`.
- Belt straight-row mapping is `BELT_STRAIGHT_INDEX = {0: 2, 4: 0, 8: 3, 12: 1}`
  (blueprint direction -> 0-based row from prototype east/west/north/south
  indices 1-4); pipes/walls use NESW bitmask variant keys "0000".."1111";
  underground belts use variant keys "in"/"out"; UG/loader structure sheets pack
  columns N,E,S,W (same as direction4 via `UG_STRUCTURE_INDEX`; outputs use the
  opposite flow direction so paired hoods face away from each other).

## Pipeline outputs (tools/pipeline)

Written to `assets-out/<game-version>/` (gitignored — Wube assets must never be committed):

- `render-db.<sha256>.json` — schema-2 `RenderDb` for each density tier
- `atlas.<sha256>.webp` / `atlas.<sha256>.png` — deterministic usage-aware pages,
  normally at most 1024×1024; `1x` uses lossless WebP and `2x` uses PNG
- `manifest.json` — stable schema-2 entry point with the game/mod set and `1x`/`2x`
  descriptors, dimensions, hashes, byte sizes, and render databases

The same directory layout is what gets uploaded to the CDN under `/<game-version>/…`,
so `cdnAssets(base + "/<version>")` and `localAssets("assets-out/<version>")` are
interchangeable.

## Testing tiers

1. **Decode fixtures** (`fixtures/decode/`): exact JSON assertions. Blueprint strings
   committed as `.txt`, expected models as `.json`.
2. **Draw-list snapshots** (`fixtures/drawlist/`): `planDrawList` output serialized with
   stable key order and numbers rounded to 4 decimals via the provided
   `serializeDrawList()` helper. Reviewable text diffs are the point.
3. **Golden PNGs** (`fixtures/golden/`): small curated local baselines,
   pixel-diffed with a 0.1% tolerance. PNG files are gitignored (not
   redistributed); blueprint strings and `cases.json` are committed. Tests skip
   automatically when local atlases or golden PNGs are absent.
4. **Ground truth** (`fixtures/ground-truth/`, gitignored): PNGs from the real game via
   `tools/ground-truth`; dev-time reference for approval only, never asserted in CI.

## Licensing stance

Sprites and atlases are Wube Software property. Raw PNG atlases (`assets-out/`) are
never committed to git, never bundled in the npm package, and any CDN hosting must be
clearly non-redistributive (same stance as FBE). A metadata-only render-db fixture
(`fixtures/render-db/`) — coordinates and mappings, no pixels — is committed for test
reproducibility. Golden PNG renders are gitignored and generated locally by developers
who own Factorio. The pipeline exists so any user can regenerate full assets from
their own game installation.

_Factorio is a trademark of Wube Software Ltd. This project is not affiliated with or
endorsed by Wube Software._
