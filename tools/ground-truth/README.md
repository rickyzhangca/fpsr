# @fpsr/ground-truth

Dev-only CLI that screenshots a Factorio blueprint string with the **real** 2.1.11 graphics client. Output is human reference ("ground truth") when approving renderer golden images. **Not for CI.**

It also owns the manifest-driven visual-suite runner: exact-profile audit, capture, page rendering,
stable cell crops, and expected-vs-rendered diff reports.

## Requirements

- macOS Factorio graphics client at `/Applications/factorio.app` (2.1.11)
- Only **one** Factorio instance can run at a time (user-data lock)
- Does **not** touch `~/Library/Application Support/factorio/mods/mod-list.json`

## Usage

```bash
pnpm -F @fpsr/ground-truth run shoot -- <bp-file-or--> [--name out] [--alt] [--ppt 64]

# Clear fixtures/ground-truth/*.game.png and re-shoot every golden case
# (viewer built-ins: smoke, belt-ring, pipe-plant from fixtures/golden/cases.json)
# in a **single** Factorio launch.
pnpm ground-truth:refresh

# Base test book: audit, manifest-selected canary, or all 35 pages
pnpm visual-tests:audit
pnpm visual-tests:canary
pnpm visual-tests:all

# Official-mod test book: generate, audit, canary, or all 6 pages
pnpm visual-tests:generate:official
pnpm visual-tests:official:audit
pnpm visual-tests:official:canary
pnpm visual-tests:official:all
```

Examples:

```bash
pnpm -F @fpsr/ground-truth run shoot -- fixtures/decode/01-minimal-chest.txt
pnpm -F @fpsr/ground-truth run shoot -- fixtures/decode/90-real-wiki-example.txt --name 90-wiki
pnpm -F @fpsr/ground-truth run shoot -- - --name from-stdin --alt < bp.txt
pnpm ground-truth:refresh
```

Camera size/position is planned by **fpsr** (`planDrawList` → `computeTileFrame`) so each
shot matches the golden/renderer canvas. Requires a generated `assets-out/2.1.11/`
schema-2 bundle.
Fallback (no fpsr view fields in the job) uses entity collision/selection boxes.

| Flag     | Default         | Meaning                                                            |
| -------- | --------------- | ------------------------------------------------------------------ |
| `--name` | input basename  | Output basename (required for stdin)                               |
| `--alt`  | off             | `show_entity_info` (alt-mode icons)                                |
| `--ppt`  | `64`            | Match fpsr `pixelsPerTile` (Factorio zoom = ppt/32; `64` → zoom 2) |
| `--zoom` | —               | Legacy alias: sets ppt = zoom×32                                   |
| (rig)    | `PAD_TILES = 0` | Match fpsr default `padTiles: 0`                                   |

## How it stages mods

1. Creates a fresh temp dir `/tmp/fpsr-ground-truth-mods-<pid>-<ts>/`
2. Writes `mod-list.json` enabling official packs only: `base`, `elevated-rails`, `quality`, `recycler`, `space-age`, plus `fpsr-rig`
3. Copies `rig-mod/` → `<tmp>/fpsr-rig/` and overwrites `scenarios/rig/jobs.lua` with this run’s job list (one or more blueprints + names)
4. Launches:

   ```text
   factorio --load-scenario fpsr-rig/rig --mod-directory <tmp> --disable-audio --disable-migration-window
   ```

5. Watches stdout for `FPSR_RIG_SHOT:<name>` per capture and `FPSR_RIG_DONE` when finished (or `FPSR_RIG_ERROR:…`), copies each  
   `~/Library/Application Support/factorio/script-output/fpsr-rig/<name>.png`  
   → `fixtures/ground-truth/<name>.game.png`, SIGTERMs the game (SIGKILL after 5s), deletes the temp mod dir
6. Hard timeout: **120s** + **30s per extra job**

The Base visual-suite path overrides step 2 with exactly `base` + `fpsr-rig`; the ordinary
single-blueprint and legacy refresh commands retain the all-official profile.

## Base visual suite

The suite is committed at `fixtures/visual-tests/base-game/` as one nested book plus a manifest.
The runner extracts selected leaf pages as bare blueprint strings because the Factorio rig does not
import whole books.

- `visual-tests:audit` validates the suite plus exact Factorio, asset, and reference profiles.
- `visual-tests:canary` selects the three deterministic pages declared by the Base manifest.
- `visual-tests:all` runs all manifest pages, eight pages per Factorio process by default.
- References are full-page game PNGs under ignored `fixtures/ground-truth/<suite>/ppt-<n>/`.
- `index.json` binds every reference to the blueprint hash, PNG hash, manifest path, camera frame,
  game version, mod list, and pixels-per-tile.
- Comparison renders once per page, evaluates every manifest crop, and writes JSON plus only failing
  page/cell expected/actual/diff PNGs under `build/visual-tests/`.

The default required asset directory is `assets-out/2.1.11-base`. Generate it from an exact 2.1.11
client with:

```bash
pnpm assets:build:base -- --factorio /path/to/factorio-2.1.11.app
```

The runner checks `factorio --version` and the asset manifest before launch. It refuses a mismatched
game version or the all-official asset bundle, preventing mislabeled Base goldens.

## Official-mod visual suite

The per-mod books at `fixtures/visual-tests/official-mods/` cover the placeable inventory added by
Elevated Rails, Recycler, and Space Age. Each official mod owns a separate specification; the
Quality specification is intentionally empty because Quality adds no placeable entity or tile.
The suite uses the exact all-official asset profile at `assets-out/2.1.11` and declares four canary
pages in its manifest.

The official workflow uses `visual-tests:official:*`. Runtime placement constraints and renderer
pixel correctness are not foundation-generation gates: this stage checks inventory ownership,
exact profiles, deterministic books, page addressing, and simple default placements. Any planner
problem found while packing an entity is recorded in the committed manifest as a renderer
diagnostic instead of becoming an inventory/spec failure.

## Scenario flow

1. Create one fixed-seed surface per page with `generate_with_lab_tiles = true` (lab-dark checkerboard), `always_day` / frozen daytime
2. `request_to_generate_chunks` + `force_generate_chunk_requests` + `force.chart`
3. Build every job in `jobs.lua` during the same tick, settle them together, then request every screenshot during the same tick so animation phase does not depend on batch position:
   1. Recreate a clean lab surface (after the first job)
   2. `game.create_inventory(1)` → `stack.import_stack(bp)` (expects a single blueprint, not a book)
   3. Try `stack.build_blueprint{…}` then revive ghosts; on empty ghosts fall back to `get_blueprint_entities()` + `surface.create_entity`
   4. Destroy any `character`, settle 3 ticks, bbox from selection/collision boxes, `take_screenshot`, print `FPSR_RIG_SHOT:<name>`
4. Print `FPSR_RIG_DONE` (no scripting `exit_game` in 2.1.11 — launcher SIGTERMs)

## `take_screenshot` parameters

| Param                      | Value                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| `surface`                  | `fpsr-rig`                                                                |
| `position`                 | bbox center                                                               |
| `resolution`               | tiles × 32 × zoom (+1.5 tile pad), capped at 4096; zoom reduced if needed |
| `zoom`                     | CLI `--zoom` (default 2)                                                  |
| `path`                     | `fpsr-rig/<name>.png`                                                     |
| `show_entity_info`         | `--alt`                                                                   |
| `anti_alias`               | `false`                                                                   |
| `hide_clouds` / `hide_fog` | `true`                                                                    |
| `daytime`                  | `0`                                                                       |
| `water_tick`               | `0`                                                                       |
| `force_render`             | `true`                                                                    |

## Caveats

- Single Factorio instance (user-dir lock); quit other sessions first
- Graphics client required (`take_screenshot` is a no-op headless)
- `factorio_version` in the rig mod must be `"2.1"` (not `"2.0"`) or 2.1.11 rejects the mod
- Unpowered entities → idle / frame-0 sprites (intentional for stable reference)
- `build_blueprint` currently fails open on the script surface; direct `create_entity`
  covers sprites. Wires are restored afterward from the decoded blueprint `wires`
  array via `get_wire_connector` / `connect_to`.
- Blueprint books are rejected; water / space / planetary tiles may not match the lab-tile backdrop
- Output is for local human review, not CI golden diffs
