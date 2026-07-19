# Render layers: official vs fpsr

## Official sources

1. **Enum order** — Factorio `RenderLayer` union (lowest → highest):
   - https://lua-api.factorio.com/latest/types/RenderLayer.html
   - Mirrored as `FACTORIO_RENDER_LAYERS` in [`packages/renderer/src/types/draw-list.ts`](../packages/renderer/src/types/draw-list.ts).

2. **Per-sprite / per-piece layers from `--dump-data`** when the prototype exposes them, e.g.:
   - `pictures.render_layers` (rails)
   - `graphics_set.animation_list[].render_layer` (beacon)
   - `ground_picture_set.structure_render_layer` (rail signals)
   - `structure_render_layer` (loaders)
   - nested `belt_reader[].render_layer` (whole-belt-read skirts)

In distill, these go through `officialLayer(...)` in [`tools/pipeline/src/render-layers.ts`](../tools/pipeline/src/render-layers.ts).

## Not in the dump (engine-hardcoded)

Most placeable bodies (inserter, assembling machine, chest, pipe, pole, furnace, belt _sheet_, …) have **no** `render_layer` field. Distill marks those with `guessedLayer(name, reason)`.

Common guesses today:

| Kind                                | Guess                                | Why                                          |
| ----------------------------------- | ------------------------------------ | -------------------------------------------- |
| Default entity body                 | `object`                             | Typical Factorio default                     |
| Inserter platform                   | `floor`                              | Under belt sheet (in-game look)              |
| Inserter hands                      | `higher-object-under`                | Above belts and assembling-machine bodies    |
| Belt animation sheet (in render-db) | `transport-belt`                     | FBE; dump only labels `belt_reader` overlays |
| UG back patch                       | `object-under`                       | Under the hood                               |
| Splitter structure_patch (E/W tops) | `object`                             | Y-sort with UG hoods; sub under structure    |
| Tiles                               | `ground-tile` (fpsr ≈ `under-tiles`) | fpsr name                                    |

## Paint order (Factorio-aligned)

Inserters are **split**: platform under the belt sheet; hands above belts **and** above `object` bodies (assemblers) so arms aren’t buried in the machine. Belts stay at Factorio `transport-belt` — no raise above `object`.

| Paint order (bottom → top)                   | Layer                              | Index |
| -------------------------------------------- | ---------------------------------- | ----- |
| Inserter platform                            | `floor`                            | 26    |
| Standalone / UG belt underlays               | `transport-belt`                   | 27    |
| Belt circuit connector cage + LEDs           | `transport-belt-circuit-connector` | 35    |
| Entity / CCM / pipe-cover shadows            | `shadow`                           | 37    |
| Assembling machines, chests, poles, UG hoods | `object`                           | 39    |
| Inserter hands                               | `higher-object-under`              | 41    |
| Inserter CCM mains                           | `higher-object-above`              | 42    |
| Wires, elevated, …                           | official                           | ≥46   |
| Blueprint snap-to-grid rectangle             | `selection-box`                    | 66    |

Whole-belt-reader skirts (`belt_animation_set.belt_reader`) draw when `circuit_read_hand_contents` + `circuit_contents_read_mode === 2` (`entire_belt_hold`); the skirt propagates along the transport line including underground belts (official layers under the hood so rails appear to run through). Sheet layout is band×NESW (`StraightSolidBand` / `StraightOpenBand` / `CurvedSolidBand` / `Ending` × N/E/S/W edge frames). Straights paint both long-side edges; open line ends also get `Ending` short-edge caps (rail “grabs” the tip). Ending cells are inward hooks flush to the tip edge — a mirrored copy is also painted one tile past the tip so the outer half of the fancy cap appears. Curves use `CurvedSolidBand`.

Belt cage LEDs are gated by `control_behavior`: `circuit_enabled` (or legacy `circuit_enable_disable`) → `led_red`/`led_green`; `circuit_read_hand_contents` → `led_blue`. The connector sheet's four frames are the behavior-state bitmask (none/output/input/both), not compass directions. Factorio bakes H/V décor into each `frame_main` state; fpsr splits it at distill time and recomposites the plates present in the selected state at plan time.

See `emitBeltCircuitConnectors` / `emitBeltReaders` in `packages/renderer/src/plan.ts`. Snap-grid overlay: `emitSnapGrid` draws a dashed green perimeter when `"snap-to-grid"` is set.

## fpsr-only names

`fpsrLayer(...)` — not in Factorio’s enum: `shadow`, `ground-tile`, `tile-transition`, `water-tile`, `icons`, plus legacy aliases `rail-ties` / `elevated-rail-ties` (prefer official `rail-tie` / `elevated-rail-tie` from dump).

## How to tell them apart in code

| Helper                       | Meaning                            |
| ---------------------------- | ---------------------------------- |
| `officialLayer(dumpString)`  | Value came from Factorio dump/API  |
| `guessedLayer(name, reason)` | fpsr heuristic; reason is required |
| `fpsrLayer(name, reason)`    | Invented / aliased name            |

Grep `guessedLayer` / `fpsrLayer` / `officialLayer` in `tools/pipeline` to audit.
