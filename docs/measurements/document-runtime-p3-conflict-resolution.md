# Document runtime P3 conflict resolution

Verified on 2026-09-26 in `/home/chell/repos/amanite` on the Linux desktop
environment used by the embedded Tauri WebDriver.

## Bounded behavior

This slice covers explicit resolution after an open native page changes on
disk:

- Reload reads the current Fractal page, clears its recovery draft in order,
  replaces the existing Lexical session, and resets the conflict state.
- Replace disk captures the live local session and writes the local title,
  body, style, and metadata sections against hashes from a fresh Fractal read.
  It no longer relies on the old dirty-section set, so a clean local session
  can still replace an external body change.
- A conditional conflict during replacement keeps the local sections and the
  conflict action available.
- Protected documents expose reload only. Amanite cannot offer a native
  section replacement for markup it cannot preserve.
- The conflict alert stays visible while reload or replacement is in flight.

The replacement command is exposed as `replaceExternal` through the workspace
document hook. The generic save path still owns ordinary saves and autosaves.

## Focused tests

The new tests cover a successful local-wins replacement, a replacement that
conflicts again after its fresh read, a reload barrier, a failed reload read,
and suppression of a recovery draft while reload is resolving.

Commands:

```text
pnpm exec vitest run src/features/workspace/documents/documentPersistence.test.ts src/features/workspace/documents/documentRecovery.test.ts src/features/workspace/documents/useDocumentLoading.test.tsx src/features/workspace/components/EditorGroupPane.test.ts
```

Result: 4 files, 40 tests passed.

Repository checks also passed:

```text
pnpm test                         # 42 files, 164 tests
pnpm run build
cargo test --manifest-path src-tauri/Cargo.toml  # 25 tests
pnpm run tauri:webdriver:doctor
```

## Real Tauri verification

The final full smoke reused the valid debug WebDriver build produced through
the Tauri CLI. It passed the external edit, local-wins replacement, explicit
reload, warm switching, split-group close/reopen, recovery, move/recreate,
forced-termination recovery, and project reopen scenarios.

Artifact: [`full smoke`](../../artifacts/tauri-webdriver/2026-09-26T08-11-42-204Z/)

The typing regression passed on the small and 1,500-paragraph native fixtures.
Both retained live and disk text, produced seven successful autosaves, and
recorded zero editor imports or mounted snapshot requests. Its injected real
conditional-write failure retained text and left the conflict visible.

Artifact: [`typing regression`](../../artifacts/tauri-webdriver/2026-09-26T08-13-17-346Z/)

The first rebuilt smoke run exposed a UI regression: clearing `error` at save
start hid the conflict alert before the native writes finished. The alert now
shows its resolving state until the operation acknowledges or fails. The final
desktop smoke passed after that fix.

## Remaining gaps

This does not complete P3. Title-driven structural barriers, link rewrites that
affect other open documents, delete and repair policy, export barriers, and
undo decisions for source replacement remain. The precise change-during-force
race is covered by deterministic persistence tests, not by the desktop smoke.

The real desktop run did not use a malformed or protected fixture. Permissions,
disk-full, indeterminate Fractal outcomes, power loss, Windows, macOS,
Wayland/X11 separation, real IME input, the 60-second performance matrix, and
the full serialization cost breakdown remain unverified. The large typing run
also recorded a 630 ms longest frame, so the declared 100 ms stall target
remains open.

The remaining temporary bridges are unchanged: the mounted
`registerEditorFlush`/`EditorSnapshot` contract for legacy fallback and
composition handling, the optional persistence `flushDocument` path and
`snapshotRevision` field, and the legacy `sharedDocumentEditor` fallback.
Normal registry saves, recovery, reload, and replace-disk resolution do not use
those bridges.
