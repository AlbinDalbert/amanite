# R5 compact catalog verification

R5 separates catalog metadata from document content. A catalog page contains
only `path`, `title`, and `contentHash`. Opening or refreshing a project no
longer selects and serializes the first page. `fractal_read_page` remains the
explicit full-document read, while `fractal_search_project` returns at most 20
saved snippets by default and never more than 100.

Live editor models overlay saved search results by path. Results carry the
backend catalog version and session generation; the query index rejects values
from another version or generation. Mutation responses carry
`baseCatalogVersion`. The frontend applies affected metadata entries through
the central receipt path and preserves unrelated object references. A base
version gap triggers `fractal_open_project_path` as the explicit full catalog
resynchronization path.

## Payload measurement

The Rust contract fixture creates 100 unrelated pages containing 250,000 body
characters in total. The old page-array shape, including saved text and links,
serializes to 268,689 bytes. A create-page mutation on the same catalog is
10,691 bytes. The equivalent mutation before adding the unrelated body text is
10,625 bytes, a 66-byte difference caused by the different created-page title.
The root folder entry still lists its 102 children, so response size can grow
with affected catalog metadata; it does not grow with unrelated document text.

Reproduce the measurement:

```sh
cargo test --manifest-path src-tauri/Cargo.toml \
  mutation_payload_does_not_include_unrelated_page_text -- --nocapture
```

## Checks

- `pnpm test`: 37 files and 126 tests passed.
- `pnpm run build`: TypeScript and the production Vite build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 23 Rust tests passed.

Contract tests cover metadata-only catalogs, explicit-content startup,
mutation payload independence from unrelated bodies, compact update reference
preservation, saved fallback, live overlays, and stale saved-result rejection.
