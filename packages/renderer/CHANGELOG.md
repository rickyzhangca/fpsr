# Changelog

## 0.0.1

First public release.

- ESM library for browser and Node.js targeting Factorio **2.1.11** (vanilla + Space Age + Elevated Rails + Quality)
- Entry points: `@rickyzhangca/fpsr`, `@rickyzhangca/fpsr/planner`, `@rickyzhangca/fpsr/canvas`, `@rickyzhangca/fpsr/render-db`, `@rickyzhangca/fpsr/node`
- Decode/encode blueprint strings, resolve connectivity, plan draw lists, and render to Canvas2D
- Sprite atlases and render database are **not** bundled — load via `cdnAssets` or `localAssets` from your own pipeline output
