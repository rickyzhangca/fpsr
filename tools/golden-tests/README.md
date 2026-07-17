# Golden PNG regression tests

Curated blueprint renders are pixel-compared against committed PNGs in `fixtures/golden/`.

## Commands

```bash
# Regenerate committed goldens (requires local assets)
pnpm -F @fpsr/golden-tests run update

# Run pixel-diff tests
pnpm goldens:test
```

## Workflow

1. Open the viewer **Compare** tab and visually verify each case against ground-truth game screenshots (when available).
2. After approval, run `pnpm -F @fpsr/golden-tests run update` on a machine with pipeline assets. Golden PNGs are **gitignored** (not redistributed); keep them locally for regression testing.

Goldens are generated on the machine that has `assets-out/2.1.11/` (from `pnpm -F @fpsr/pipeline run pipeline all`). Tests **skip** automatically when assets or golden PNGs are absent so CI stays green on clean checkouts.

Cross-platform anti-aliasing differences (if any) are absorbed by the **0.1% pixel
tolerance** (pixelmatch threshold 0.1). Regenerate with `pnpm goldens:update` on the
same kind of machine you care about matching.

## Corpus

Case definitions live in `fixtures/golden/cases.json`. Blueprint strings are `*.bp.txt` siblings; committed goldens are `<name>.png`. Failed comparisons write debug images to `fixtures/golden/__diff__/` (gitignored).
