# fpsr

Headless **Factorio 2.1.11** blueprint-string renderer for browser and Node.js.
Decodes compressed blueprint strings, resolves connectivity-aware sprite variants
(belts, pipes, walls, rails, trains, wires), plans a serializable draw list, and
executes it on a Canvas2D backend.

Supports vanilla plus **Space Age**, **Elevated Rails**, and **Quality** content
from the official data packages.

**Docs:** [https://fpsr-docs.fprints.xyz](https://fpsr-docs.fprints.xyz) · **Viewer:** [https://fpsr.fprints.xyz](https://fpsr.fprints.xyz)

## Install

```bash
npm install @rickyzhangca/fpsr
```

For Node.js rendering, add the optional peer dependency:

```bash
npm install skia-canvas
```

The npm package ships **code only** — sprite atlases and the render database are
not included. See [Asset hosting](https://fpsr-docs.fprints.xyz/guide/assets) in the docs.

## Quick start (browser)

```ts
import { cdnAssets, createRenderer, decode } from "@rickyzhangca/fpsr";

const doc = decode(blueprintString);
const renderer = await createRenderer({
  assets: cdnAssets("https://your-cdn.example.com/2.1.11"),
});

const { canvas } = await renderer.render(doc);
document.body.appendChild(canvas as HTMLCanvasElement);
```

## Quick start (Node.js)

```ts
import { writeFile } from "node:fs/promises";
import { Canvas } from "skia-canvas";
import { createRenderer, decode } from "@rickyzhangca/fpsr";
import { localAssets } from "@rickyzhangca/fpsr/node";

const doc = decode(blueprintString);
const renderer = await createRenderer({
  assets: localAssets("assets-out/2.1.11"),
  createCanvas: (w, h) => new Canvas(w, h),
});

const { toPngBuffer } = await renderer.render(doc);
await writeFile("out.png", await toPngBuffer());
```

## More

Full guides, API reference, and monorepo docs: **[fpsr-docs.fprints.xyz](https://fpsr-docs.fprints.xyz)**.

## Versioning

- **npm package**: semver; breaking changes may land in 0.x.
- **Render database schema**: version `2`.
- **Game target**: Factorio **2.1.11** exactly.

## License

**Source code** is MIT. **Factorio game assets** are property of Wube Software Ltd.
and are not included in this package. See [Licensing](https://fpsr-docs.fprints.xyz/project/licensing).

_Factorio is a trademark of Wube Software Ltd. This project is not affiliated
with or endorsed by Wube Software._
