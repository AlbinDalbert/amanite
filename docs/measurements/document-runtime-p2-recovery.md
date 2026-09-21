# Document runtime P2 recovery scheduling

Completed on 2026-09-21 for the bounded cutover that gives
`DocumentRecoveryCoordinator` all recovery scheduling for live registry
sessions.

## Shipped behavior

- The coordinator subscribes to `DocumentRegistry`, attaches to body and title
  revisions, and owns idle, maximum-wait, retry, and close/dispose state.
- Native sessions capture and encode their live `DocumentSession`, rebuild a
  draft from the accepted native source, and write through the ordered Fractal
  draft adapter. They do not ask a mounted editor for a snapshot.
- Protected sessions use the same coordinator. Because Fractal does not expose
  writable native sections for them, recovery writes the exact workspace source
  projection. Lexical never serializes protected markup.
- The old `useDocumentDrafts` React scheduler and its compatibility-only test
  path are deleted. Native autosave remains limited to buffers with writable
  native sections.
- Registry close and dispose cancel pending timers and retries.

## Focused verification

```sh
pnpm exec vitest run \
  src/features/workspace/documents/documentRecovery.test.ts \
  src/features/workspace/documents/documentPersistence.test.ts \
  src/features/workspace/useWorkspaceDocuments.test.tsx
```

Passed: 3 files and 32 tests. The cases cover registry recovery for a
protected session, exact-source draft output, autosave exclusion, retry after a
transient recovery failure, cancellation after session close, native capture
without a mounted snapshot, and the existing workspace conflict behavior.

## Full verification

- `pnpm test`: passed, 42 files and 156 tests.
- `pnpm run build`: passed, including `tsc -b` and the Vite production build.
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed, 25 tests.
- `pnpm run tauri:webdriver:doctor`: passed.
- `pnpm run tauri:webdriver:smoke`: passed through the rebuilt real Tauri
  desktop. The build used
  `pnpm exec tauri build --debug --no-bundle --features webdriver`.
  Evidence is in
  [`artifacts/tauri-webdriver/2026-09-21T16-11-08-816Z`](../../artifacts/tauri-webdriver/2026-09-21T16-11-08-816Z/).

The desktop run edited a detached native session, checked its recovery draft,
injected a transient draft-write failure, observed failure followed by retry
success, then exercised draft recovery after forced termination and project
reopen. The event log contains `document.capture` and `document.encode` for
the native path and no `snapshot.request` start for coordinator recovery.

The desktop fault is injected at Amanite's debug-only page-draft adapter because
the Tauri WebView freezes its IPC internals binding. This checks coordinator
failure, retry, and local-content retention through the real app. It does not
claim coverage for Rust command failure, permissions, disk-full storage, or
power loss.

## Remaining gaps

- The real desktop run used valid native sessions. It did not open a malformed
  or protected fixture. Protected exact-source recovery is covered by focused
  JSDOM persistence tests.
- The workspace source/body projection and mounted
  `registerEditorFlush`/`EditorSnapshot` bridge remain. The bridge is still
  needed by legacy fallback and composition handling, but coordinator recovery
  no longer depends on it.
- The required 60-second performance matrix, representative 100k, 1m, and 5m
  fixtures, deliberately slow storage, and capture/encoding cost breakdown
  remain open.
- Permissions, disk-full, indeterminate Fractal outcomes, power loss, Windows,
  macOS, Wayland/X11 separation, and real IME coverage remain unverified.
