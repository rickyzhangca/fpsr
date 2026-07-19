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

### Large PNG export

For full-resolution images that may exceed browser canvas limits, use the tiled
PNG exporter. It renders bounded temporary canvases and feeds their rows into an
incremental PNG encoder, so it never creates one canvas at the final dimensions:

```ts
const { blob, width, height } = await renderer.renderTiledPng(doc, {
  pixelsPerTile: 64,
  tileSize: 2048,
  onProgress(event) {
    console.log(event);
  },
});

const link = document.createElement("a");
link.href = URL.createObjectURL(blob);
link.download = `blueprint-${width}x${height}.png`;
link.click();
URL.revokeObjectURL(link.href);
```

The exporter always produces lossless PNG. Canvas-based WebP export remains
available through `render(...).toImageBlob({ type: "image/webp" })` for outputs
that fit safely in one canvas.

## Quick start (Node.js)

```ts
import { writeFile } from "node:fs/promises";
import { Canvas } from "skia-canvas";
import { createRenderer, decode } from "fpsr";
import { localAssets } from "fpsr/node";

const doc = decode(blueprintString);
const renderer = await createRenderer({
  assets: localAssets("assets-out/2.1.11"),
  createCanvas: (w, h) => new Canvas(w, h),
});

const { toPngBuffer } = await renderer.render(doc);
await writeFile("out.png", await toPngBuffer());
```

`localAssets` reads schema-2 `manifest.json` and the selected `1x` or `2x`
content-addressed render DB and atlas files from a pipeline output directory on
disk. Asset sources default to `2x`; callers can set `assetTier` when creating a
renderer. The render DB's `assetDensity` must match the selected tier or
`createRenderer` throws `AssetDensityMismatchError`.

## Package entry points

| Import           | Contents                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| `fpsr`           | Decode/encode, books, migrate, `createRenderer`, `cdnAssets`, core types |
| `fpsr/planner`   | `resolve`, `planDrawList`, draw-list helpers, belt/train/wire utilities  |
| `fpsr/canvas`    | `executeDrawList`, background painters, silhouette helpers               |
| `fpsr/render-db` | Full `RenderDb` / entity / terrain type surface                          |
| `fpsr/node`      | `localAssets` (filesystem; requires `skia-canvas`)                       |

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
import { decode, migrateTo2x, selectBlueprint } from "fpsr";
import { planDrawList, resolve, serializeDrawList } from "fpsr/planner";
import renderDb from "./render-db.json" with { type: "json" };

const bp = migrateTo2x(selectBlueprint(decode(source))); // optional; plan/resolve also migrate
const { entities, warnings } = resolve(bp, renderDb);
const list = planDrawList(bp, renderDb, { altMode: true });
const snapshot = serializeDrawList(list); // stable JSON for fixtures
```

`serializeDrawList` rounds coordinates to four decimal places with stable key
order for reviewable text diffs.

## Backgrounds

`RenderOptions.background` is a discriminated union:

```ts
await renderer.render(doc, { background: { type: "auto" } });
await renderer.render(doc, { background: { type: "checkerboard" } });
await renderer.render(doc, { background: { type: "space", planet: true, planetName: "nauvis" } });
await renderer.render(doc, { background: { type: "terrain", name: "dirt" } });
await renderer.render(doc, { background: { type: "none" } });
```

Unknown terrain names throw `UnknownTerrainBackgroundError` (they do not render
as transparent).

## AbortSignal

`renderer.render` / `measure` / `renderTiledPng` honor `signal`. Asset loads via
`cdnAssets` / `localAssets` accept `loadAtlasImage(i, tier, { signal })`.

**Semantics:** aborting rejects only the waiting caller with `AbortError`. Shared
in-flight fetches/decodes continue for other concurrent consumers of the same
cache key. Aborted waits never poison a successful cache entry; genuine load
failures clear the shared promise so a later call can retry.

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

### Planner (`fpsr/planner`)

| Export                    | Kind     | Description                                                                |
| ------------------------- | -------- | -------------------------------------------------------------------------- |
| `resolve`                 | function | `(bp, renderDb, opts?)` → `{ entities, warnings }`                         |
| `planDrawList`            | function | `(bp, renderDb, opts?)` → `DrawList`                                       |
| `planDrawListWithOptions` | function | Same as plan; returns `{ drawList, profile? }` when `profile: true`        |
| `analyzePlan`             | function | `(bp, drawList, renderDb)` → resolve coverage + draw-list integrity checks |
| `PlanOptions`             | type     | `altMode`, `beltEndings`, optional `profile`                               |
| `serializeDrawList`       | function | Stable JSON serialization for fixtures                                     |

### Rendering (`fpsr`)

| Export                          | Kind     | Description                                                          |
| ------------------------------- | -------- | -------------------------------------------------------------------- |
| `createRenderer`                | function | High-level async renderer (plan + load + paint)                      |
| `cdnAssets` / `localAssets`     | function | HTTP / filesystem `AssetSource`                                      |
| `MeasureOptions`                | type     | Layout-only options for `measure`                                    |
| `RenderOptions`                 | type     | Public paint options (`background`, `altMode`, `showCoordinates`, …) |
| `TiledPngOptions`               | type     | Full-resolution PNG options (no `profile` / canvas / maxOutputSize)  |
| `RenderBackground`              | type     | Discriminated background mode                                        |
| `AssetDensityMismatchError`     | class    | Thrown when render-db density does not match `assetTier`             |
| `UnknownTerrainBackgroundError` | class    | Thrown for unknown `background: { type: "terrain", name }`           |
| `Renderer`                      | type     | `{ measure, render, renderTiledPng, dispose }`                       |

`Renderer.dispose()` clears renderer-owned icon/silhouette caches only. It does
**not** call `AssetSource.dispose()` or close atlas images owned by the asset
source — those remain the caller's responsibility.

### Canvas (`fpsr/canvas`)

| Export                  | Kind     | Description                       |
| ----------------------- | -------- | --------------------------------- |
| `executeDrawList`       | function | Paint a `DrawList` onto a context |
| `Canvas2DContextLike`   | type     | Minimal Canvas2D context          |
| `drawTileCheckerboard`  | function | Tile-aligned checkerboard fill    |
| `drawSpaceBackground`   | function | Procedural starfield              |
| `drawTerrainBackground` | function | Named terrain patches             |

### Blueprint / render-db types

| Export               | Kind | Description                                    |
| -------------------- | ---- | ---------------------------------------------- |
| `BlueprintDocument`  | type | Exactly-one top-level wrapper (`blueprint`, …) |
| `BlueprintBookEntry` | type | Exactly-one book-slot content key              |
| `RenderDb`           | type | Pipeline-produced sprite/layer database        |
| `FrameId`            | type | Numeric frame index into `RenderDb.frames`     |
| `FrameMeta`          | type | Atlas frame trim and scale metadata            |

## Asset hosting

Rendering requires a content-addressed **render database** and packed **sprite
atlases** in deterministic `1x` and `2x` tiers described by a schema-2
`manifest.json`. These are generated from **your own game files** using the offline pipeline in this repository
([`@fpsr/pipeline`](https://github.com/rickyzhangca/fpsr/tree/main/tools/pipeline)).

They are **never redistributed** with the npm package or committed to git. Host
them on private infrastructure (`cdnAssets`) or load from disk (`localAssets`).

## Versioning

- **npm package**: semver; breaking changes may land in 0.x.
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
