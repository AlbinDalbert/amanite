# R6 ordering and reconciliation verification

The project-session registry now stores one mutex per canonical project root.
The registry lock is held only while locating or creating a session. Cached
reads, refreshes, and mutations serialize within one project without blocking
operations on an already-open unrelated project.

A refresh acquires the project mutex before opening Fractal. The controlled
race test pauses that open, starts a mutation, and verifies that the mutation
cannot complete until the refresh publishes. The final cached project contains
the mutation. This directly covers the stale replacement order that existed
when the project was opened before acquiring the lock.

Refresh compares Fractal's manifest, pages, and folders with the cached model.
An unchanged refresh replaces the internal model without advancing the catalog
version. Cached reads do not reopen Fractal. Backend session generation stays
stable across refreshes; the separate frontend project generation continues to
identify editor and recovery incarnations.

Mutation wire results carry their base catalog version. The client applies an
update only when that base joins its current catalog. A gap records
`ipc.catalog-resync` and opens a full metadata snapshot. Receipts still flow
through the workspace reconciliation path for page/folder mappings, drafts,
tabs, histories, open buffers, and query entries. The compact-update tests
verify that renamed and rewritten entries are applied while unrelated catalog
references remain identical. Existing persistence tests cover partial section
success, committed/indeterminate error policy, and preservation of newer or
unsent edits.

Checks run for this package:

```sh
cargo test --manifest-path src-tauri/Cargo.toml project_session -- --nocapture
pnpm test
pnpm run build
```

The focused backend run passed four project-session tests. The frontend run
passed 37 files and 126 tests, followed by a successful TypeScript and Vite
production build. The complete Rust suite is rerun in R7 because its many-page
payload fixture is intentionally slower.
