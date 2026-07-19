# @fpsr/cdn-upload

Upload pipeline asset directories to BunnyCDN Storage for private hosting of
render atlases and the render database.

```bash
pnpm -F @fpsr/cdn-upload run upload -- --dir assets-out/2.1.11 --dry-run
```

## Usage

1. Generate assets locally with `@fpsr/pipeline` (see `tools/pipeline/README.md`).
2. Set the Storage Zone password below.
3. Run `upload` — files are PUT to `https://{host}/{zone}/{gameVersion}/{filename}`,
   preserving the on-disk layout under the game version prefix.

Before any upload starts, the same schema, hash, image-dimension, frame-reference,
and tier-size checks used by `pnpm assets:verify` must pass. Only files referenced
by `manifest.json` are uploaded; local reports and stale files are excluded.

Content-addressed atlas and render-database files upload six-at-a-time by default,
with bounded retries for network errors, HTTP 408/429, and 5xx responses. The stable
`manifest.json` is uploaded only after all content succeeds, so a release becomes
visible atomically. Generated lossless WebP atlases use the `image/webp` content type.

`--dry-run` performs the full local verification, prints every file that would be
uploaded (with sizes), and skips network I/O. Relative `--dir` values resolve from
the repository root. Use `--concurrency <1-16>` to adjust upload parallelism.

The production pull hostname is `https://fpsr.b-cdn.net`. Its Pull Zone must allow
CORS for both `webp` and `json`. Cache content-addressed files normally, but give
`*/manifest.json` a zero-second edge and browser TTL so same-version releases do
not remain pinned to an older manifest.

## Environment variables

| Variable                 | Required | Default                | Description                |
| ------------------------ | -------- | ---------------------- | -------------------------- |
| `BUNNY_STORAGE_PASSWORD` | yes\*    | —                      | Storage Zone password      |
| `BUNNY_STORAGE_ZONE`     | no       | `fpsr`                 | BunnyCDN Storage Zone name |
| `BUNNY_STORAGE_HOST`     | no       | `storage.bunnycdn.com` | Storage API hostname       |
| `BUNNY_API_KEY`          | no       | —                      | Legacy password variable   |

\*Not required when `--dry-run` is passed.

The Bunny CLI account login is useful for configuring the Pull Zone, but it is
separate from the Storage Zone password used by the upload API.

## Local viewer CDN access

The Pull Zone requires signed requests outside the production viewer origin.
Generate a short-lived directory token for local CDN debugging with:

```bash
pnpm cdn:debug-token
```

This uses the authenticated Bunny CLI to read the Pull Zone signing key in
memory and writes only a 24-hour token to the gitignored
`apps/viewer/.env.local`. Restart Vite after generating or refreshing it. Use
`-- --hours <n>` to select a lifetime up to seven days. Never put the Pull Zone
security key in a `VITE_` environment variable.

## Licensing warning

Uploaded sprites and atlases are **Wube Software property**. Keep the CDN
**private and non-redistributive** — do not expose a public download endpoint or
mirror the assets for third parties. The same stance applies to this repository;
see the root [README](../../README.md) licensing section. End users of `fpsr`
should generate assets from their own Factorio installation via `@fpsr/pipeline`.
