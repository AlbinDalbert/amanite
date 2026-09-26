# Document runtime P3 title barrier

Verified on 2026-09-26 in `/home/chell/repos/amanite` on the Linux desktop
environment used by the embedded Tauri WebDriver.

## Bounded behavior

This slice completes title-driven structural saves for registry-backed native
documents:

- Title keystrokes stay in the live session. Autosave persists body work while
  a title field is active without issuing repeated title mutations.
- Blur and explicit Save commit the title through a serialized structural
  barrier. The barrier settles active composition, disables every open session
  in the project, preflights pending non-title sections in path order, runs
  Fractal's conditional title mutation, and restores each session's prior
  editability.
- The Fractal receipt maps the moved page and rewritten pages. Open sessions
  are renamed in place, so their document IDs, editors, selection, and history
  do not change.
- A body change proven to be href-only is applied as a derived Lexical
  transaction. It uses `AMANITE_DERIVED_LINK_TAG` and `HISTORIC_TAG`, so the
  editor does not publish a user revision and the existing undo stack remains.
  Live derived models are invalidated after the transaction.
- If the affected source differs beyond a safe link rewrite, or the new native
  source cannot be inspected, Amanite leaves the open editor untouched and
  marks the page as an explicit conflict. The alert directs the user to
  reload the native source, which resets undo history, or use Replace disk to
  keep the local source. No routine save silently replaces the editor.

## Focused tests

The focused suite covers safe and unsafe body comparisons, empty native-body
canonicalization, history-preserving link transactions, title-only autosave
suppression, serialized editability, receipt-driven path/link reconciliation,
and the explicit unsafe conflict path.

```text
pnpm exec vitest run \
  src/features/workspace/documents/documentStructuralCommands.test.ts \
  src/features/workspace/documents/documentRuntime.test.ts \
  src/features/workspace/documents/documentPersistence.test.ts
```

Result: 3 files, 44 tests passed during the final focused run. The repository
frontend suite passed 43 files and 172 tests.

## Real Tauri verification

The current debug WebDriver binary was built through:

```text
pnpm exec tauri build --debug --no-bundle --features webdriver
```

The full smoke passed with the title barrier extension. It verified an open
`my-file.fractal.html` link changing after `index.fractal.html` was renamed,
then raced a second title edit against an external disk edit and verified the
conflict UI retained the original path and exposed Reload disk. The smoke
then continued through split panes, settings, warm switching, recovery,
move/recreate, forced termination recovery, and reopen.

Artifacts: [`full smoke`](../../artifacts/tauri-webdriver/2026-09-26T10-53-26-671Z/)

The run also passed:

```text
pnpm run tauri:webdriver:doctor
cargo test --manifest-path src-tauri/Cargo.toml  # 25 tests
```

## Temporary bridges and remaining gaps

The mounted `registerEditorFlush`/`EditorSnapshot` bridge, optional
`flushDocument`/`snapshotRevision` persistence fields, and legacy
`sharedDocumentEditor` path remain for compatibility. The title barrier does
not call the mounted snapshot bridge for normal registry-backed capture; it
uses direct sessions and `settleEditorComposition`.

This slice does not implement structural barriers for folder moves, deletes,
repair, or export. Fractal outcomes reported as mutation-committed,
indeterminate, or recovery-required still use the existing uncertainty path;
receipt-driven open-document reconciliation for those outcomes is not yet
complete. The desktop case uses a normal editable project, not malformed or
protected markup. Permissions, disk-full, real power loss, Windows, macOS,
Wayland/X11 separation, real IME input, and the 60-second performance matrix
remain unverified. The previously measured 630 ms maximum frame keeps the
declared 100 ms stall target open.
