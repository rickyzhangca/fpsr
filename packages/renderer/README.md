# fpsr

Headless **Factorio 2.1.11** blueprint-string renderer for browser and Node.js.
Decodes compressed blueprint strings, resolves connectivity-aware sprite variants
(belts, pipes, walls, rails, trains, wires), plans a serializable draw list, and
executes it on a Canvas2D backend.

Supports vanilla plus **Space Age**, **Elevated Rails**, and **Quality** content
from the official data packages.

## Install

```bash
npm install fpsr
```

For Node.js rendering, add the optional peer dependency:

```bash
npm install skia-canvas
```

The npm package ships **code only** — sprite atlases and the render database are
not included (see [Asset hosting](#asset-hosting)).

## Quick start (browser)

```ts
import { cdnAssets, createRenderer, decode } from "fpsr";

const doc = decode(blueprintString);
const renderer = await createRenderer({
  assets: cdnAssets("https://your-cdn.example.com/2.1.11"),
});

const { canvas } = await renderer.render(doc);
document.body.appendChild(canvas as HTMLCanvasElement);
```

`createRenderer` loads the render database once, plans the draw list, sizes a
canvas from blueprint bounds, and paints atlas sprites. Pass `blueprintPath` when
rendering a nested blueprint book entry.

## Quick start (Node.js)

```ts
import { Canvas } from "skia-canvas";
import { createRenderer, decode } from "fpsr";
import { localAssets } from "fpsr/node";

const doc = decode(blueprintString);
const renderer = await createRenderer({
  assets: localAssets("assets-out/2.1.11"),
  createCanvas: (w, h) => new Canvas(w, h),
});

const { toPngBuffer } = await renderer.render(doc);
await Bun.write("out.png", toPngBuffer());
```

`localAssets` reads schema-2 `manifest.json` and the selected `1x` or `2x`
content-addressed render DB and atlas files from a pipeline output directory on
disk. Asset sources default to `2x`; callers can set `assetTier` when creating a
renderer.

## Blueprint books

```ts
import { decode, listBlueprints, selectBlueprint } from "fpsr";

const doc = decode(bookString);
const refs = listBlueprints(doc); // flattened tree with paths

const bp = selectBlueprint(doc, [0, 2]); // third child of first entry
```

`selectBlueprint(doc)` without a path follows the book's `active_index` chain.

## Pure planning (no assets)

For tests, diff tooling, or custom backends, call the pure pipeline stages
directly — no images or network required beyond loading the render DB named by
`manifest.json`:

```ts
import {
  decode,
  migrateTo2x,
  planDrawList,
  resolve,
  selectBlueprint,
  serializeDrawList,
} from "fpsr";
import renderDb from "./render-db.json" with { type: "json" };

const bp = migrateTo2x(selectBlueprint(decode(source))); // optional; plan/resolve also migrate
const resolved = resolve(bp, renderDb);
const list = planDrawList(bp, renderDb, { pixelsPerTile: 32 });
const snapshot = serializeDrawList(list); // stable JSON for fixtures
```

`serializeDrawList` rounds coordinates to four decimal places with stable key
order for reviewable text diffs.

## API reference

### Decoding

| Export                  | Kind     | Description                                                       |
| ----------------------- | -------- | ----------------------------------------------------------------- |
| `decode`                | function | Parse a blueprint string or raw JSON string → `BlueprintDocument` |
| `encode`                | function | Serialize a `BlueprintDocument` back to a blueprint string        |
| `migrateTo2x`           | function | Migrate a 1.x `Blueprint` to 2.x shape (idempotent)               |
| `migrateDocumentTo2x`   | function | Migrate every nested blueprint in a document / book               |
| `BLUEPRINT_ADAPTERS`    | const    | Ordered 1.x→2.x adapter registry                                  |
| `BlueprintAdapter`      | type     | `{ id, apply }` adapter entry                                     |
| `BlueprintDecodeError`  | class    | Thrown when `decode` fails                                        |
| `BlueprintDecodeReason` | type     | Error reason codes for decode failures                            |
| `decodeVersion`         | function | Split encoded `version` into major/minor/patch                    |

### Blueprint books

| Export                  | Kind     | Description                                             |
| ----------------------- | -------- | ------------------------------------------------------- |
| `listBlueprints`        | function | Flatten a book tree → `BlueprintRef[]` with index paths |
| `selectBlueprint`       | function | Select a nested blueprint by optional `number[]` path   |
| `BlueprintSelectError`  | class    | Thrown when book navigation fails                       |
| `BlueprintSelectReason` | type     | Error reason codes for selection failures               |

### Connectivity resolver

| Export                  | Kind     | Description                                         |
| ----------------------- | -------- | --------------------------------------------------- |
| `resolve`               | function | `(bp, renderDb, warningsOut?)` → `ResolvedEntity[]` |
| `dir16ToIndex`          | function | Map 16-way Factorio direction → variant index       |
| `cardinalDirection`     | function | Normalize direction to N/E/S/W                      |
| `rotateOffset`          | function | Rotate a tile offset by entity direction            |
| `trainOrientationIndex` | function | Train heading → sprite orientation index            |
| `railDirectionIndex`    | function | Rail piece direction → variant index                |
| `BELT_STRAIGHT_INDEX`   | const    | Belt straight-row mapping by direction              |
| `BELT_CURVE_LEFT`       | const    | Left-turn belt curve indices                        |
| `BELT_CURVE_RIGHT`      | const    | Right-turn belt curve indices                       |
| `BELT_START_INDEX`      | const    | Belt lane start indices                             |
| `BELT_END_INDEX`        | const    | Belt lane end indices                               |
| `ResolvedEntity`        | type     | Entity with chosen sprites and layer metadata       |
| `LayerSelection`        | type     | Selected render layer for an entity                 |
| `ResolveOptions`        | type     | Options for `resolve`                               |

### Draw-list planner

| Export                     | Kind     | Description                                                                  |
| -------------------------- | -------- | ---------------------------------------------------------------------------- |
| `planDrawList`             | function | `(bp, renderDb, opts?)` → `DrawList`                                         |
| `analyzePlan`              | function | `(bp, drawList, renderDb)` → resolve coverage + draw-list integrity checks   |
| `PlanDiagnostics`          | type     | Result of `analyzePlan`                                                      |
| `countBlueprintComponents` | function | `(bp, renderDb)` → inventory counts (rails → `rail`, tiles via placing item) |
| `BlueprintComponentCount`  | type     | `{ name, count }` entry from `countBlueprintComponents`                      |
| `planAltModeCommands`      | function | Plan blueprint-derived entity-info icons for one entity                      |
| `altSignalFrame`           | function | Resolve a Blueprint `SignalId` through the render-db catalog                 |
| `tileVariantHash`          | function | Hash tile coordinates for variant selection                                  |
| `PlanOptions`              | type     | `altMode`, `background`, belt-ending behavior, etc.                          |

### Wire connectors

| Export               | Kind     | Description                        |
| -------------------- | -------- | ---------------------------------- |
| `wireConnectorColor` | function | Color for a circuit wire connector |
| `WIRE_CONNECTOR_ID`  | const    | Connector id constants             |
| `WireColor`          | type     | Red / green / copper wire colors   |

### Asset sources

| Export             | Kind     | Description                                      |
| ------------------ | -------- | ------------------------------------------------ |
| `cdnAssets`        | function | `AssetSource` over HTTP (`fetch` atlases + JSON) |
| `localAssets`      | function | Node-only filesystem source (`fpsr/node` export) |
| `AssetSource`      | type     | `loadRenderDb()` + `loadAtlasImage(index)`       |
| `AssetManifest`    | type     | Pipeline `manifest.json` shape                   |
| `CdnAssetsOptions` | type     | Optional `fetchImpl` / `decodeImage` overrides   |

### Canvas backend

| Export                     | Kind     | Description                                                                                 |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `drawTileCheckerboard`     | function | Paint tile-aligned checkerboard onto a 2D context                                           |
| `blitWithTileCheckerboard` | function | Composite an image over a tile-aligned checkerboard                                         |
| `executeDrawList`          | function | Paint a `DrawList` onto a 2D context                                                        |
| `createRenderer`           | function | High-level async renderer (plan + load + paint)                                             |
| `Canvas2DContextLike`      | type     | Minimal Canvas2D context interface                                                          |
| `ExecuteDrawListOptions`   | type     | Frame metadata and scale options                                                            |
| `ExecuteDrawListStats`     | type     | Shadow run, tile, composited-pixel, and peak-scratch counters                               |
| `CreateRendererOptions`    | type     | `assets`, optional `renderDb`, `createCanvas`                                               |
| `CreateCanvasFn`           | type     | `(width, height)` → canvas                                                                  |
| `CanvasLike`               | type     | Canvas / OffscreenCanvas / skia-canvas surface                                              |
| `RenderOptions`            | type     | Per-render overrides (`blueprintPath`, `altMode`, `showCheckerboard`, `showCoordinates`, …) |
| `RenderResult`             | type     | `{ canvas, width, height, drawList, toPngBlob, toPngBuffer }`                               |
| `Renderer`                 | type     | `{ render(docOrBp, opts?) }`                                                                |

### Draw-list types

| Export              | Kind     | Description                                     |
| ------------------- | -------- | ----------------------------------------------- |
| `DrawList`          | type     | Serializable render intermediate representation |
| `DrawCmd`           | type     | Union of sprite / icon / wire / rect commands   |
| `SpriteCmd`         | type     | Atlas sprite draw command                       |
| `IconCmd`           | type     | Entity-info icon with optional backing/rotation |
| `WireCmd`           | type     | Circuit wire draw command                       |
| `RectCmd`           | type     | Solid rectangle (e.g. background tiles)         |
| `DrawListBounds`    | type     | Tile-space bounding box                         |
| `RENDER_LAYERS`     | const    | Layer ordering table                            |
| `compareDrawCmd`    | function | Stable sort comparator for draw commands        |
| `serializeDrawList` | function | Stable JSON serialization for fixtures          |

### Blueprint model types

| Export               | Kind | Description                   |
| -------------------- | ---- | ----------------------------- |
| `Blueprint`          | type | Single blueprint payload      |
| `BlueprintBook`      | type | Nested book container         |
| `BlueprintBookEntry` | type | Book child entry              |
| `BlueprintDocument`  | type | Top-level decoded document    |
| `BlueprintEntity`    | type | Placed entity                 |
| `BlueprintRef`       | type | Book tree reference with path |
| `BlueprintWire`      | type | Circuit wire connection       |
| `Tile`               | type | Floor tile                    |
| `Position`           | type | `{ x, y }` map coordinates    |
| `Color`              | type | RGBA color                    |
| `Icon`               | type | Signal icon descriptor        |
| `SignalId`           | type | Circuit signal identifier     |

### Render database types

| Export            | Kind | Description                               |
| ----------------- | ---- | ----------------------------------------- |
| `RenderDb`        | type | Pipeline-produced sprite/layer database   |
| `EntityRenderDef` | type | Per-entity render definition              |
| `TileRenderDef`   | type | Per-tile render definition                |
| `SpriteVariant`   | type | Directional / connectivity sprite variant |
| `LayerGroup`      | type | Ordered sprite layers for an entity       |
| `FrameMeta`       | type | Atlas frame trim and scale metadata       |
| `FrameId`         | type | Frame identifier string                   |
| `AtlasMeta`       | type | Atlas index metadata                      |
| `EntityKind`      | type | Entity classification for rendering       |
| `RenderLayerName` | type | Named render layer                        |

## Asset hosting

Rendering requires a content-addressed **render database** and packed **sprite
atlases** in deterministic `1x` and `2x` tiers described by a schema-2
`manifest.json`. These are generated from **your own game files** using the offline pipeline in this repository
([`@fpsr/pipeline`](https://github.com/rickyzhangca/fpsr/tree/main/tools/pipeline)).

They are **never redistributed** with the npm package or committed to git. Host
them on private infrastructure (`cdnAssets`) or load from disk (`localAssets`).

## Versioning

- **npm package**: semver via Changesets.
- **Render database schema**: version `2` (see `RenderDb` in source).
- **Game target**: Factorio **2.1.11** exactly (vanilla + Space Age + Elevated
  Rails + Quality).

A new game version requires regenerating assets and may require a matching
library release.

## License

**Source code** in this package is released under the [MIT License](LICENSE).

**Factorio game assets** — all sprites, icons, and atlases are the property of
**Wube Software Ltd.** They are not included in this package and must not be
redistributed. Generate assets locally from a licensed Factorio installation via
`@fpsr/pipeline`. The monorepo commits a metadata-only render-db test fixture (no
pixel data); golden PNG test renders are not redistributed.

_Factorio is a trademark of Wube Software Ltd. This project is not affiliated
with or endorsed by Wube Software._
