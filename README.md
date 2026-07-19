# fpsr

Factorio **2.1.11** blueprint-string renderer — a TypeScript monorepo that decodes
compressed blueprint strings, plans connectivity-aware draw lists, and renders
them to canvas in the browser or Node.js.

**Docs:** [https://fpsr-docs.fprints.xyz](https://fpsr-docs.fprints.xyz) · **Viewer:** [https://fpsr.fprints.xyz](https://fpsr.fprints.xyz) · **npm:** [`@rickyzhangca/fpsr`](https://www.npmjs.com/package/@rickyzhangca/fpsr)

## Monorepo map

| Path                 | Package                                   | Purpose                                                                           |
| -------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/renderer`  | [`@rickyzhangca/fpsr`](packages/renderer) | Core library (npm) — decode/encode, resolver, draw-list planner, Canvas2D backend |
| `apps/viewer`        | `@fpsr/viewer`                            | GUI for pasting, inspecting, previewing, and exporting blueprint strings          |
| `tools/pipeline`     | `@fpsr/pipeline`                          | Offline asset extraction from a local Factorio install → `assets-out/<version>/`  |
| `tools/cdn-upload`   | `@fpsr/cdn-upload`                        | Upload pipeline assets to private BunnyCDN Storage                                |
| `tools/render-cli`   | `@fpsr/render-cli`                        | CLI to render a blueprint string to PNG (Node + skia-canvas)                      |
| `tools/corpus`       | `@fpsr/corpus`                            | Blueprint corpus generation for fixtures and regression inputs                    |
| `tools/golden-tests` | `@fpsr/golden-tests`                      | Curated golden PNG regression suite (pixel-diff)                                  |
| `tools/ground-truth` | `@fpsr/ground-truth`                      | Capture reference screenshots from the real game (dev only)                       |
| `fixtures/`          | —                                         | Committed decode/draw-list fixtures and local visual-test artifacts               |

See [Project docs](https://fpsr-docs.fprints.xyz/project) for architecture, structure, and render-layer contracts.

## End-to-end workflow

```
Supported Factorio install (version detected from game metadata)
        │
        ▼
  @fpsr/pipeline  ──►  assets-out/<detected-version>/
  (dump → distill → pack)     tiered render-db/atlas assets + manifest.json
        │                              │
        │                              ├──► @fpsr/cdn-upload  ──► private CDN
        │                              │
        ▼                              ▼
  fpsr (library)  ◄── cdnAssets() or localAssets()
  decode → resolve → planDrawList → Canvas2D
        │
        ├──► @fpsr/viewer        paste / inspect / preview / export
        ├──► @fpsr/render-cli    headless PNG export
        ├──► @fpsr/golden-tests  pixel-diff against approved PNGs
        └──► @fpsr/ground-truth  compare against real-game screenshots (dev)
```

1. **Pipeline** extracts sprites and metadata from your licensed game install.
2. **Assets** land in `assets-out/<game-version>/` (gitignored) and optionally on a
   private CDN.
3. **Renderer** (`@rickyzhangca/fpsr`) decodes blueprint strings and paints them using those assets.
4. **Viewer / golden-tests / ground-truth** close the loop: inspect output in the
   browser, catch local PNG regressions, and compare against the real game through
   the CLI visual suites during development.

## Development

Requires [Vite+](https://viteplus.dev/) (`vp`) and pnpm. From the repo root:

```bash
vp install
# or: pnpm install
```

| Command                                            | Description                                          |
| -------------------------------------------------- | ---------------------------------------------------- |
| `pnpm dev` / `vp dev apps/viewer`                  | Start the blueprint viewer (`@fpsr/viewer`)          |
| `pnpm build`                                       | Build all packages                                   |
| `pnpm test`                                        | Run unit and contract tests                          |
| `pnpm check`                                       | Check filenames, format, lint, and types             |
| `pnpm lint` / `vp lint`                            | Lint only                                            |
| `pnpm format` / `vp fmt`                           | Format only                                          |
| `pnpm assets:build`                                | Generate and verify assets from local Factorio       |
| `pnpm assets:verify`                               | Verify hashes, dimensions, and frame references      |
| `pnpm assets:bench -- temp.txt`                    | Report atlas working set for a blueprint             |
| `pnpm renderer:bench-thread -- temp.txt`           | Compare main-thread and worker render responsiveness |
| `pnpm -F @fpsr/cdn-upload run upload -- --dry-run` | Preview CDN upload manifest                          |
| `pnpm goldens:update`                              | Regenerate golden PNGs (requires local assets)       |
| `pnpm goldens:test`                                | Run golden PNG pixel-diff tests                      |
| `pnpm ground-truth:refresh`                        | Clear + re-shoot game screenshots for golden cases   |

## Testing tiers

1. **Decode fixtures** (`fixtures/decode/`) — exact JSON assertions from committed
   blueprint strings.
2. **Draw-list snapshots** (`fixtures/drawlist/`) — `planDrawList` output via
   `serializeDrawList()`; reviewable text diffs.
3. **Golden PNGs** (`fixtures/golden/`) — canary pages from the 2.1.11 visual-test
   books, pixel-diffed in tests (0.1% tolerance). Skipped when local atlases are absent.
4. **Ground truth** (`fixtures/ground-truth/`, gitignored) — PNGs from the real
   game via `@fpsr/ground-truth`; dev-time reference only, never asserted in CI.

## Licensing

**Source code** in this repository is released under the [MIT License](LICENSE).

**Factorio game assets** — all sprites, icons, and atlases are the property of
**Wube Software Ltd.** They are:

- never committed to this repository (see `assets-out/` in `.gitignore`),
- never bundled in the `@rickyzhangca/fpsr` npm package, and
- never intended for public redistribution.

**Test fixtures** — a distilled **metadata-only** render database
(`fixtures/render-db/2.1.11.json`: entity definitions, frame coordinates, icon
keys — no pixel data) is committed for test reproducibility. **Golden PNGs**
(`fixtures/golden/*.png`) are **not** committed; generate them locally with
`pnpm goldens:update` after running the pipeline on a licensed Factorio install.

Generate full assets locally from your own Factorio installation via
`@fpsr/pipeline`. Any CDN hosting (via `@fpsr/cdn-upload`) must remain
**private and non-redistributive** — the same stance as Factorio Blueprint
Editor (FBE).

_Factorio is a trademark of Wube Software Ltd. This project is not affiliated
with or endorsed by Wube Software._
