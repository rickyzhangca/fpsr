# Local golden PNG regression tests

Canary pages from the 2.1.11 visual-test blueprint books are pixel-compared
against local PNG baselines in `fixtures/golden/`.

## Commands

```bash
# Regenerate local goldens (requires local assets)
pnpm -F @fpsr/golden-tests run update

# Run pixel-diff tests
pnpm goldens:test
```

## Workflow

1. Validate renderer accuracy against the real game with `pnpm visual-tests:canary`
   or `pnpm visual-tests:all`.
2. After the visual suite passes, run `pnpm goldens:update` on a machine with
   pipeline assets.
3. Run `pnpm goldens:test` to verify the refreshed local baselines.

Golden PNGs are **gitignored** and not redistributed; keep them locally for
regression testing.

Goldens are generated on the machine that has `assets-out/2.1.11/` (from `pnpm -F @fpsr/pipeline run pipeline all`). Tests **skip** automatically when assets or golden PNGs are absent so CI stays green on clean checkouts.

Cross-platform anti-aliasing differences (if any) are absorbed by the **0.1% pixel
tolerance** (pixelmatch threshold 0.1). Regenerate with `pnpm goldens:update` on the
same kind of machine you care about matching.

## Corpus

`fixtures/golden/cases.json` is a thin config (`selection` + `ppt`). Cases are
derived at load time from the visual-test manifests:

- `fixtures/visual-tests/base-game/` (`book.bp.txt`)
- `fixtures/visual-tests/official-mods/` (per-mod `*.bp.txt`)

Default `selection: "canary"` matches `pnpm visual-tests:canary` /
`pnpm visual-tests:official:canary` (7 pages). Set `"selection": "all"` to cover
every manifest page. Local goldens are `<sanitized-page-id>.png`. Failed
comparisons write debug images to `fixtures/golden/__diff__/` (gitignored).
