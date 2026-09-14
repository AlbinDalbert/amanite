# D5 verification

Completed on 2026-09-14 after D0 through D4 had been committed.

## Structural result

- Project pages remain the saved catalog, while open Lexical sessions publish
  revision-tagged live models through one in-memory `DocumentQueryIndex`.
- `PageTitleIndex` owns title/path lookup, duplicate-title filtering, link
  typeahead, and derived-link targets. Body-only catalog updates keep its
  title-group cache and rebuild counter unchanged.
- Folder search, folder previews/counts, Quick Open, link typeahead, and
  Borealis use the shared query policy. Live session text and titles overlay
  saved catalog values; unopened pages fall back to saved text.
- Bounded reads slice indexed text by range and report revision/freshness.
  The index is memory-only; durable content remains native Fractal source.

## Verification evidence

- `pnpm exec tsc -b --pretty false`: passed.
- `pnpm test -- --runInBand`: 36 test files and 112 tests passed.
- `pnpm run build`: passed.
- `pnpm run tauri:webdriver:smoke`: passed through the real Tauri desktop
  harness. The run is recorded under
  `artifacts/tauri-webdriver/2026-09-14T21-13-27-536Z/`.
- Focused tests cover title-index invalidation, duplicate titles, live query
  overlays, bounded reads, removal back to saved content, folder search, and
  Borealis search/read behavior.

## Remaining limits

The catalog still arrives as a Fractal project snapshot and therefore carries
saved page text; D6 will add explicit Rust-side freshness and retained project
state. A document's first live query still requires its editor model to report
once, and saved-page paragraph counts remain an inexpensive approximation.
No worker is assumed: the first model computation and Lexical DOM work remain
on the editor runtime.
