# Document runtime P2 autosave scheduling

Completed on 2026-09-21 as part of the coordinator cutover for live registry
sessions.

## Shipped behavior

- `DocumentRecoveryCoordinator` owns the autosave idle deadline, maximum wait,
  one in-flight write, revision coalescing, close/dispose cancellation,
  success/failure telemetry, and the auto-save setting.
- Registry-backed native saves use the existing Fractal persistence path with a
  non-draining request. Explicit saves can still upgrade that work and drain
  newer edits.
- A failed autosave keeps the captured local source/body in the workspace
  buffer. The live session stays editable, and the failed revision is not
  retried forever without a newer edit.
- Protected sessions are recovery-only. Without writable native sections they
  never enter the autosave path.
- `useDocumentDrafts` and its compatibility autosave scheduler are deleted.

## Focused verification

Autosave behavior remains covered by the coordinator-backed cases in
`documentPersistence.test.ts` and `documentRecovery.test.ts`. The focused
coordinator/persistence/workspace run passed 32 tests.

## Desktop evidence

The rebuilt full Tauri smoke passed the coordinator recovery failure and retry
path, forced termination recovery, and reopen. Its artifact is
[`artifacts/tauri-webdriver/2026-09-21T16-11-08-816Z`](../../artifacts/tauri-webdriver/2026-09-21T16-11-08-816Z/).

The current typing run passed for five-paragraph and 1,500-paragraph native
fixtures. Each produced seven autosave requests, seven successes, zero
snapshot requests, zero imports, and preserved live and disk text. The small
fixture had p95 17 ms and a 28 ms maximum frame. The large fixture had p95 28
ms and a 450 ms maximum frame. The injected external edit produced one
autosave failure, preserved the live text, and produced zero snapshot
requests. Evidence is in
[`artifacts/tauri-webdriver/2026-09-21T16-15-48-888Z`](../../artifacts/tauri-webdriver/2026-09-21T16-15-48-888Z/).

## Remaining gaps

- The required 60-second performance matrix, representative 100k, 1m, and 5m
  fixtures, deliberately slow storage, and capture/encoding cost breakdown
  remain open.
- The autosave conditional-write failure uses an external edit through the real
  Fractal path. The recovery retry fault uses Amanite's debug-only page-draft
  adapter. Permissions, disk-full, indeterminate outcomes, and power loss are
  untested.
- The workspace source/body projection and mounted
  `registerEditorFlush`/`EditorSnapshot` bridge remain for legacy fallback and
  composition handling. They are no longer used by coordinator scheduling.
- Only this Linux desktop environment was exercised. Windows, macOS,
  Wayland/X11 separation, and real IME coverage remain unverified.
