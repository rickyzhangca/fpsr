# Changelog

## 0.0.2

- Fluid connections: recipe-gated working visualisation (fixes foundry clipped pipes), blue fluid-port arrows in alt mode
- Inserter plans: improved fuel-inventory signal handling
- Rendering: tighter sprite drawing and coordinate-overlay strokes that stay on-canvas
- Draw lists / pipeline: updated pipe-connection frames; atlas packing with configurable WebP effort and concurrency
- API: cull accidental public exports; add unstable prepared-viewport entry and Node browser stub
- Docs and repo hygiene: API pages synced to culled surface; shared tool dependency catalog; corpus Aquilo frozen-tile ownership

## 0.0.1

First public release.

- ESM library for browser and Node.js targeting Factorio **2.1.11** (vanilla + Space Age + Elevated Rails + Quality)
- Entry points: `@rickyzhangca/fpsr`, `@rickyzhangca/fpsr/planner`, `@rickyzhangca/fpsr/canvas`, `@rickyzhangca/fpsr/render-db`, `@rickyzhangca/fpsr/node`
- Decode/encode blueprint strings, resolve connectivity, plan draw lists, and render to Canvas2D
- Sprite atlases and render database are **not** bundled — load via `cdnAssets` or `localAssets` from your own pipeline output
