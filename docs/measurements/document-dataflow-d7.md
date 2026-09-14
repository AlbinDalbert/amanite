# D7 verification

Completed on 2026-09-15 after D0 through D6 had been committed.

## Structural result

- Receipt parsing now produces one mutation scope for created, rewritten,
  deleted, moved, and folder entries. Direct page moves compose with folder
  moves, and unchanged page/folder catalog objects retain their references.
- Workspace mutation publication applies that scope to document paths, tabs,
  tab history, closed-tab records, drafts, and affected-document refreshes in
  one operation. Section saves use the same scope for path and draft
  reconciliation.
- Dirty buffers are not discarded because a refreshed catalog no longer lists
  their path. Explicit delete actions may dispose of their covered buffers
  after the scoped barrier succeeds; external absence remains a missing,
  recoverable document state.
- Page repair, duplicate, delete, folder close/export, and folder-scoped save
  barriers cover only known affected pages. Folder title changes and page moves
  keep a conservative all-page barrier because Fractal can rewrite arbitrary
  linked documents. Settings, validation, and normal tab activation have no
  persistence barrier.
- Page and folder exports resolve renamed document paths after saving and send
  the selected saved paths through Fractal. Uncertain section outcomes trigger
  a best-effort explicit project refresh while retaining local edits and the
  outcome state.

## Verification evidence

- `pnpm exec tsc -b --pretty false`: passed.
- `pnpm test -- --runInBand`: 36 test files and 117 tests passed.
- `pnpm run build`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 20 tests passed.
- `pnpm run tauri:webdriver:doctor`: passed.
- `pnpm run tauri:webdriver:smoke`: passed through the real Tauri desktop
  harness. The full-build run is recorded under
  `artifacts/tauri-webdriver/2026-09-14T21-59-02-514Z/`.
- Focused regression coverage proves receipt composition, catalog reference
  reuse, tab/history remapping, scoped saves, and preservation after an
  uncertain Fractal outcome.

## Remaining limits

Fractal mutation responses still contain the existing full project snapshot;
D8 will review the shipped architecture and rerun the D0 measurements rather
than claiming an IPC or latency improvement from frontend reconciliation.
Folder title changes and page moves still use conservative barriers by design
because their complete rewrite set is only known from the committed receipt.
