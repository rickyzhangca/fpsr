# @fpsr/pipeline

Offline extraction from a licensed Factorio installation into a deterministic,
schema-2 asset bundle under `assets-out/<detected-game-version>/`.

The default profile enables all official mods. `--mods base` creates a separate Base-only profile
under `assets-out/<detected-game-version>-base/` with profile-specific dump/meta files, so it cannot
silently reuse or overwrite the all-official dump.

```bash
# From the repository root
pnpm assets:build
pnpm assets:verify
pnpm assets:bench -- temp.txt
```

`assets:build` performs the complete dump → distill → usage-aware pack → hash →
verify flow. It builds in a temporary sibling directory and replaces the current
version directory only after validation succeeds.

The generated bundle contains:

- stable `manifest.json` (schema 2);
- deterministic `1x` and `2x` tier descriptors in the manifest;
- one content-addressed `render-db.<sha256>.json` per tier;
- content-addressed lossless WebP atlas pages for both tiers; and
- `distill-report.json` with generation and packing statistics.

The `1x` tier is derived directly from the same registered Factorio frames with
deterministic Lanczos downsampling; it is not a hand-authored or benchmark-specific
asset set. Logical frame geometry remains canonical while each tier records its
packed source dimensions. The viewer selects `1x` whenever the capped render is at
or below 32 px/tile and uses `2x` above that.

Atlas ownership is derived from the distilled game definitions. Blueprint files
and benchmark corpora never influence generation. Icons use small decode-local
pages, tiles are isolated, entity graphics are grouped by prototype, frames used
by two to four prototypes are cloned, and widely shared frames use shared pages.

## Factorio discovery

The CLI resolves the installation in this order:

1. `--factorio <app-root-or-executable>`;
2. `FPSR_FACTORIO_PATH`;
3. standard locations for the current OS.

Standard discovery covers `/Applications/Factorio.app` and the macOS Steam
library, `/opt/factorio` and common Linux Steam libraries, and the Windows
Program Files/Steam locations. If discovery fails, pass the installation root,
application bundle, or executable explicitly:

```bash
pnpm assets:build -- --factorio /path/to/Factorio
FPSR_FACTORIO_PATH=/path/to/Factorio pnpm assets:build
# PowerShell
$env:FPSR_FACTORIO_PATH = "C:\Program Files\Factorio"
pnpm assets:build
```

The game version is read from `data/base/info.json`; no atlas dimensions,
versioned output path, or sprite layout is hand-authored.

## Lower-level commands

```bash
pnpm -F @fpsr/pipeline run pipeline dump [--force] [--factorio <path>]
pnpm -F @fpsr/pipeline run pipeline distill [--factorio <path>]
pnpm -F @fpsr/pipeline run pipeline verify [--dir <assets-out/version>]
pnpm -F @fpsr/pipeline run pipeline bench -- <blueprint-file> [--dir <assets-out/version>]

# Exact Base-only assets used by fixtures/visual-tests/base-game
pnpm -F @fpsr/pipeline run pipeline all --mods base --factorio /path/to/factorio-2.1.11.app
```
