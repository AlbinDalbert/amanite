# Document runtime P2 recovery scheduling

Completed on 2026-09-21 for the bounded slice that moves recovery scheduling
for registry-backed documents into the document runtime.

## Shipped behavior

- `DocumentRecoveryCoordinator` subscribes to `DocumentRegistry`, attaches to
  session body/title revisions, and owns the idle, maximum-wait, retry, and
  close/dispose state for open native sessions.
- Native recovery captures and encodes the live `DocumentSession`, rebuilds a
  draft from the accepted native source, and writes through the existing
  ordered Fractal draft adapter. It does not request a mounted editor snapshot.
- `useDocumentDrafts` no longer has an open-session writer/fallback branch. It
  now schedules recovery only for compatibility buffers that have no usable
  native registry session, while it continues to schedule autosave for the
  workspace buffer set.
- The registry emits open, close, rename, and dispose events so recovery jobs
  cannot outlive their session.

## Focused verification

```sh
pnpm exec vitest run src/app/pageDrafts.test.ts \
  src/features/workspace/documents/useDocumentDrafts.test.tsx \
  src/features/workspace/documents/documentPersistence.test.ts \
  src/features/workspace/documents/documentRuntime.test.ts \
  src/features/workspace/useWorkspaceDocuments.test.tsx
```

Passed: 5 files and 41 tests. The focused cases cover native capture without a
mounted snapshot, retry after a transient write failure, cancellation after
session close, the compatibility snapshot retry path, and the split between
native autosave and legacy recovery scheduling.

## Full verification

- `pnpm test`: passed, 42 files and 157 tests.
- `pnpm run build`: passed (`tsc -b` and Vite production build).
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed, 25 tests.
- `pnpm run tauri:webdriver:doctor`: passed.
- `pnpm run tauri:webdriver:smoke`: passed through the real Tauri desktop. The
  WebDriver build used the required
  `pnpm exec tauri build --debug --no-bundle --features webdriver` path and is
  recorded under
  [`artifacts/tauri-webdriver/2026-09-21T06-43-17-295Z`](../../artifacts/tauri-webdriver/2026-09-21T06-43-17-295Z/).

The desktop flow edits a native page, switches away from its editor, verifies
the detached draft contains the edit and protected style section, and asserts
`document.capture`/`document.encode` with no `snapshot.request` start. It then
edits a clean second native page, injects one failure at the page-draft
storage adapter, and verifies `draft.confirmed` failure followed by retry
success, native draft contents, no snapshot fallback, save cleanup, ordinary
draft recovery, forced termination recovery, and project reopen.

The transient desktop fault is deliberately injected at Amanite's debug-only
page-draft adapter because Tauri freezes its IPC internals binding. It proves
the coordinator's failure, retry, and UI-preservation behavior through the
real app, but it is not a claim about a Rust command failure, permissions
failure, disk-full condition, or power loss.

## Remaining gaps

- The workspace source/body projection and mounted
  `registerEditorFlush`/`EditorSnapshot` bridge remain for legacy,
  unsupported, and not-yet-open buffers.
- `useDocumentDrafts` still owns autosave scheduling and the compatibility
  recovery scheduler. The next cut should remove that remaining compatibility
  state as more documents become registry-backed, then consolidate autosave
  scheduling under the runtime coordinator.
- The required 60-second performance matrix, deliberately slow storage, real
  filesystem/Fractal fault injection, Windows/macOS/Wayland runs, and real
  IME coverage remain unverified.
