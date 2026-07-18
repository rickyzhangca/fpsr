# Repository structure

High-level map of where production code lives after the feature-folder and domain-module
organization pass. Package boundaries are unchanged; this document describes **internal**
layout only.

See also [`README.md`](../README.md) (monorepo map) and [`CONTRACTS.md`](CONTRACTS.md)
(cross-package interfaces).

## `apps/viewer/src`

Shell entrypoints stay at the root (`main.tsx`, `app.tsx`, `styles.css`).

| Folder         | Responsibility                                                                  |
| -------------- | ------------------------------------------------------------------------------- |
| `components/`  | Brand (`logo`, `github-logo`) and shadcn `ui/*`                                 |
| `lib/`         | Shared utilities (`utils.ts`)                                                   |
| `preview/`     | Canvas preview, render worker, export/background controls, draw-list formatting |
| `process/`     | Process tab, pipeline receipt, plan diagnostics, adapter checks                 |
| `sidebar/`     | Source tree, summaries, mobile sidebar, selection                               |
| `blueprint/`   | Blueprint metadata, icons, rich text, custom blueprint storage                  |
| `json/`        | JSON viewer, syntax highlighting worker                                         |
| `performance/` | Performance tab and perf report types                                           |
| `shell/`       | Analytics, assets config, pane chrome, viewer preferences, last-view helpers    |

Workers and protocols are colocated with their feature (`preview/render.worker.ts`,
`json/json-highlight.worker.ts`).

## `packages/renderer/src`

Public API is still exported from [`index.ts`](../packages/renderer/src/index.ts).
Large modules are split behind thin facades at the old paths (`resolve.ts`, `plan.ts`,
`canvas2d.ts`).

| Folder / file | Responsibility                                                                    |
| ------------- | --------------------------------------------------------------------------------- |
| `resolve/`    | Belt/pipe/wall/train resolution, neighbor grids, `resolve` / `resolveWithContext` |
| `plan/`       | Draw-list planning: tiles, wires, pipe covers, circuit connectors, belt readers   |
| `canvas2d/`   | Canvas2D backend: sprite/wire/icon drawing, `executeDrawList`                     |
| `types/`      | Blueprint, draw-list, and render-db type barrels                                  |

## `tools/pipeline/src/distill`

| Path                    | Responsibility                                   |
| ----------------------- | ------------------------------------------------ |
| `distill.ts`            | Thin facade re-exporting the pipeline entry      |
| `distill/index.ts`      | `distillEntity` orchestration and pack entry     |
| `distill/domains/`      | Route tables and entity-kind routing             |
| `distill/shared/`       | Box/layer merge, finalize, wire/pipe helpers     |
| `distill/logistics/`    | Belts, inserters, fluids, rails, trains, circuit |
| `distill/production.ts` | Assemblers, miners, boilers, beacons, …          |
| `distill/combat.ts`     | Turrets, walls, gates, …                         |
| `distill/space.ts`      | Thrusters, cargo bays, fusion, …                 |
| `distill/other.ts`      | Generic fallback, icons, tiles, backgrounds      |

## `tools/corpus/src`

| File                    | Responsibility                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `suite-layout.ts`       | Bounds, lattice, page packing (shared by base and official-mod suites) |
| `suite-cases/`          | Page-group catalogs and case builders                                  |
| `base-suite.ts`         | `buildBaseSuite` facade                                                |
| `official-mod-suite.ts` | Official-mod book builders (uses `suite-layout.ts`)                    |

## Conventions

- **Filenames:** kebab-case (`scripts/check-filenames.mjs`).
- **Soft size budget:** production modules should stay under ~400 LOC; modules over 600 LOC
  trigger a warning in `pnpm check` (`scripts/check-module-size.mjs`).
- **Moves:** prefer thin facades at old import paths when splitting to keep dependents stable.
