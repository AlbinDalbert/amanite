# D6 verification

Completed on 2026-09-14 after D0 through D5 had been committed.

## Structural result

- Rust now retains one `fractal::Project` per canonical project root in a
  process-local `ProjectSessionStore`.
- Cached reads use the retained Fractal catalog. Explicit project opens and
  file-content-state checks refresh from disk; mutations are serialized under
  the same session lock and update the catalog version only after success.
- Every retained-session project snapshot carries a session generation,
  catalog version, and freshness (`cached`, `refreshed`, or `mutated`). Page
  reads, searches, and content-state replies carry the same publication
  metadata so late responses can be compared by their consumer.
- Fractal-heavy commands now use Tauri `spawn_blocking`, including project
  inspection/recovery, reads, searches, exports, validation, and mutations.
  Durable operations and conflict/hash checks remain in `fractal::Project`.

## Verification evidence

- `cargo test --manifest-path src-tauri/Cargo.toml`: 20 tests passed.
- `pnpm exec tsc -b --pretty false`: passed.
- `pnpm test -- --runInBand`: 36 test files and 112 tests passed.
- `pnpm run build`: passed.
- `pnpm run tauri:webdriver:smoke`: passed through the real Tauri desktop
  harness. The full-build run is recorded under
  `artifacts/tauri-webdriver/2026-09-14T21-32-19-289Z/`; the follow-up
  `--skip-build` run is under
  `artifacts/tauri-webdriver/2026-09-14T21-33-52-829Z/`.
- Rust session tests cover retained catalog reuse, monotonic mutation/refresh
  versions, generation replacement, and stale cached data remaining isolated
  until an explicit refresh.

## Remaining limits

The service is currently a process-local singleton rather than a separately
addressed frontend session API, and file polling intentionally requests a
fresh Fractal catalog to detect external changes. Mutation responses still
include the existing full project snapshot; D7 will narrow receipt
reconciliation and D8 will review compact publication, invalidation hints, and
cross-platform performance.
