# @fpsr/cdn-upload

Upload pipeline asset directories to BunnyCDN Storage for private hosting of
render atlases and the render database.

```bash
pnpm -F @fpsr/cdn-upload run upload -- [--dir assets-out/2.1.11] [--dry-run]
```

## Usage

1. Generate assets locally with `@fpsr/pipeline` (see `tools/pipeline/README.md`).
2. Set the environment variables below.
3. Run `upload` — files are PUT to `https://{host}/{zone}/{gameVersion}/{filename}`,
   preserving the on-disk layout under the game version prefix.

Content-addressed atlas and render-database files are uploaded first. The stable
`manifest.json` is always uploaded last, so a release becomes visible atomically.

`--dry-run` prints every file that would be uploaded (with sizes) and skips
network I/O. Missing credentials are allowed in dry-run mode.

## Environment variables

| Variable             | Required | Default                | Description                     |
| -------------------- | -------- | ---------------------- | ------------------------------- |
| `BUNNY_STORAGE_ZONE` | yes\*    | —                      | BunnyCDN storage zone name      |
| `BUNNY_STORAGE_HOST` | no       | `storage.bunnycdn.com` | Storage API hostname            |
| `BUNNY_API_KEY`      | yes\*    | —                      | Storage zone password / API key |

\*Not required when `--dry-run` is passed.

## Licensing warning

Uploaded sprites and atlases are **Wube Software property**. Keep the CDN
**private and non-redistributive** — do not expose a public download endpoint or
mirror the assets for third parties. The same stance applies to this repository;
see the root [README](../../README.md) licensing section. End users of `fpsr`
should generate assets from their own Factorio installation via `@fpsr/pipeline`.
