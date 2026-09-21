# Document runtime P2 autosave scheduling

Completed on 2026-09-21 for the bounded slice that moves autosave scheduling
for registry-backed native documents into `DocumentRecoveryCoordinator`.

## Shipped behavior

- The coordinator now owns the autosave idle deadline, maximum request wait,
  one in-flight write, latest-revision coalescing, close/dispose cancellation,
  success/failure telemetry, and the auto-save setting for registry sessions.
- Registry-backed native saves call the existing Fractal persistence path with
  a non-draining request. Explicit saves can still upgrade that request and
  drain newer edits.
- A captured native body and source remain in the workspace buffer when an
  autosave fails. The live session remains editable and the failed revision is
  not retried forever without a newer edit.
- A write that completes after newer typing starts a fresh idle/max-lag cycle
  for the pending revision. It does not carry an expired deadline into an
  immediate catch-up loop.
- `useDocumentDrafts` still handles autosave and recovery only for
  compatibility buffers with no usable registry session or native sections.
  It no longer schedules registry-backed native buffers.
- The desktop typing regression makes an external edit to the native file
  before autosave and checks the real conditional-write conflict path, local
  text preservation, conflict state, autosave failure telemetry, and zero
  snapshot fallback.

## Focused verification

```sh
pnpm exec vitest run \
  src/features/workspace/documents/documentPersistence.test.ts \
  src/features/workspace/documents/useDocumentDrafts.test.tsx \
  src/features/workspace/useWorkspaceDocuments.test.tsx
```

Passed: 3 files and 37 tests. The focused cases cover coordinator-owned
autosave without a mounted snapshot, in-flight edit coalescing across the
maximum-wait boundary, failed-write retention, no repeated retry for a failed
revision, compatibility scheduling, and the workspace auto-save setting.

## Full verification

- `pnpm test`: passed, 42 files and 161 tests.
- `pnpm exec tsc -b --pretty false`: passed.
- `pnpm run build`: passed (`tsc -b` and Vite production build).
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed, 25 tests.
- `pnpm run tauri:webdriver:doctor`: passed.
- `pnpm run tauri:webdriver:smoke -- --typing-regression`: passed through the
  rebuilt real Tauri desktop. The required WebDriver build path was used. The
  artifact is
  [`2026-09-21T08-02-27-250Z`](../../artifacts/tauri-webdriver/2026-09-21T08-02-27-250Z/).
- `pnpm run tauri:webdriver:smoke -- --document-runtime-smoke --skip-build`:
  completed against the same build. Evidence is in
  [`2026-09-21T08-04-05-582Z`](../../artifacts/tauri-webdriver/2026-09-21T08-04-05-582Z/).
- `pnpm run tauri:webdriver:smoke -- --skip-build`: passed the full real-app
  smoke, including warm switching, the injected recovery failure and retry,
  forced termination, and reopen. Evidence is in
  [`2026-09-21T08-04-36-551Z`](../../artifacts/tauri-webdriver/2026-09-21T08-04-36-551Z/).

The typing artifact reported the following for both the five-paragraph and
1,500-paragraph fixtures: seven autosave requests, seven successes, zero
failures, zero snapshot requests, zero imports, preserved live text, and
preserved disk text. Small-file input latency was p95 19 ms with a 35 ms
maximum frame. The large fixture was p95 35 ms with a 641 ms maximum frame.
The p95 result is within the declared target; the maximum-frame target is not.

The injected autosave failure reported `conflict: true`, one autosave failure,
preserved live text, and zero snapshot requests. The full smoke's
`dataflow-events-before-termination.json` recorded one draft failure followed
by three successful draft confirmations. The after-restart artifact recorded
no draft failure.

## Remaining gaps

- P2 is not verified as a whole. The required 60-second performance matrix,
  representative 100k, 1m, and 5m visible-character fixtures, slow-storage
  runs, and capture/encoding cost breakdown remain open.
- The large desktop fixture still exceeds the declared 100 ms maximum
  foreground-stall target, even though its p95 input-to-paint result passed.
- The autosave conditional-write failure uses an external file edit through the
  real Fractal path. The recovery retry fault remains injected at Amanite's
  debug-only page-draft adapter. Permissions, disk-full, indeterminate Fractal
  outcomes, and power loss remain untested.
- The workspace source/body projection and mounted
  `registerEditorFlush`/`EditorSnapshot` bridge remain for legacy,
  unsupported, and not-yet-open buffers. The compatibility scheduler in
  `useDocumentDrafts` remains until those buffers are registry-backed.
- The latest app logs contain only the known GTK theme warnings. Launcher
  stderr is not persisted by the harness, so allocator cleanup warnings seen
  in earlier typing runs are not independently explained.
- Only this Linux desktop environment was exercised. Windows, macOS,
  Wayland/X11 separation, and real IME coverage remain unverified.
