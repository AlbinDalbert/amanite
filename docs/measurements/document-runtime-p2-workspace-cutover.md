# Document runtime P2 workspace cutover

Completed on 2026-09-21. This slice removes the live serialized content
projection from registry-backed native workspace documents.

## Shipped behavior

- `DocumentSession` is the live title/body/revision/undo authority for an open
  document. Workspace buffers retain identity, native hashes and pending
  native section edits, but no `source`, `bodyHtml`, `title`, or title-heading
  projection.
- Loading and explicit reload install the accepted or recovered source into
  the existing registry session before committing the workspace metadata.
  Reload preserves the opaque session ID and advances only the replacement
  generation.
- `DocumentPersistence` retains accepted native source as a persistence
  baseline. Native save and recovery reconstruction read the live session at a
  boundary and never publish serialized content back into workspace state.
- Protected or compatibility-incompatible documents retain exact source only
  for protection, recovery, and recreation. They do not enter native autosave.
- File polling consults live session title/body dirtiness when deciding whether
  a disk hash is external. It no longer treats the absence of a workspace
  snapshot as evidence of an external edit.
- Clean loader replacement no longer increments the edit revision. This avoids
  phantom recovery/autosave work and removes a startup race from later retry
  behavior.

The first rebuilt desktop smoke caught that startup race: the transient draft
retry reached storage without the detached marker because a clean seeded
replacement had created an extra recovery revision. The replacement checkpoint
fix was made before the passing smoke below.

## Focused verification

```sh
pnpm exec vitest run \
  src/features/workspace/documents/documentBuffers.test.ts \
  src/features/workspace/documents/documentPersistence.test.ts \
  src/features/workspace/documents/documentRecovery.test.ts \
  src/features/workspace/documents/documentRuntime.test.ts \
  src/features/workspace/documents/useDocumentLoading.test.tsx \
  src/features/workspace/documents/useDocumentSession.test.tsx \
  src/features/workspace/documents/useProjectFilePolling.test.tsx \
  src/features/workspace/useWorkspaceDocuments.test.tsx \
  src/features/workspace/components/WorkspaceTab.test.tsx \
  src/features/workspace/components/WorkspaceTabs.test.tsx \
  src/lib/ai/workspaceTools.test.ts
```

Passed: 11 files and 57 tests. The cases include buffer authority shape,
registered baselines for non-active pages, loader replacement, live-session
polling, native recovery, protected exact-source recovery, autosave failure,
conflict retention, and registry lifetime.

Full verification also passed:

- `pnpm test`: 42 files and 160 tests.
- `pnpm run build`: TypeScript and Vite production build.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 25 tests.
- `pnpm run tauri:webdriver:doctor`.

The rebuilt full real-Tauri smoke passed native save/recovery, transient draft
failure and retry, external conflict, split-group close/reopen, forced
termination recovery, and project reopen. Its artifacts are in
[`2026-09-21T17-58-10-074Z`](../../artifacts/tauri-webdriver/2026-09-21T17-58-10-074Z/).

The real desktop typing run passed five-paragraph and 1,500-paragraph native
fixtures with seven autosave requests and successes per fixture, zero imports
and snapshot requests, and preserved live and disk text. The injected external
edit produced one autosave failure while preserving live text. Its artifacts
are in
[`2026-09-21T18-00-38-244Z`](../../artifacts/tauri-webdriver/2026-09-21T18-00-38-244Z/).
The large fixture measured p95 frame time of 34 ms and a 652 ms maximum frame.

## Remaining bridges and gaps

- The mounted `registerEditorFlush`/`EditorSnapshot` contract remains for the
  legacy editor fallback and composition handling. The normal registry save,
  recovery, and autosave paths do not call it.
- The optional persistence `flushDocument` path and `snapshotRevision` field
  remain as compatibility scaffolding for that legacy path. Production
  workspace construction does not provide the flush callback.
- `sharedDocumentEditor` remains for its legacy compatibility path. It is not
  used by production `FolderView` or normal document tabs.
- Persistence still retains accepted native source for boundary reconstruction,
  and protected documents retain exact source. These are intentional
  persistence/protection data, not a second live document model or durable page
  format.
- The desktop fault injection covers coordinator retry at the Amanite draft
  adapter. Permissions, disk-full, indeterminate Fractal outcomes, power loss,
  malformed/protected desktop fixtures, and real IME input remain unverified.
- The required 60-second performance matrix and 100k/1m/5m fixtures remain
  open. The current large fixture exceeds the declared 100 ms maximum-stall
  target, so the responsiveness gate remains open.
- Only this Linux desktop environment was exercised. Windows, macOS,
  Wayland/X11 separation, and production builds without the debug-only
  WebDriver feature remain unverified.
