# @fpsr/pipeline

Offline Factorio 2.1.9 asset extraction → `assets-out/`.

```bash
pnpm -F @fpsr/pipeline run pipeline [dump|distill|pack|all] [--force]
```

- **dump** — runs the local Factorio binary with a temp official-only mod list; writes `assets-out/data-raw-dump.json` (+ `.meta.json`). Skips if present unless `--force`.
- **distill** / **pack** — one pass: distill entities, tiles, prototype icon
  placement, the complete Blueprint SignalID icon catalog, and entity-info utility
  sprites into `assets-out/2.1.9/{render-db.json,atlas-*.png,manifest.json}`.

Requires a Factorio 2.1.9 install at `/Applications/factorio.app`.
