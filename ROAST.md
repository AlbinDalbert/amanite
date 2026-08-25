# Amanite code roast

Reviewed 2026-08-25 on `main`.

## Verdict

**Amanite is good enough for continued feature work, with one important limitation: rich editing is still not lossless for every valid Fractal document. Incompatible documents are now protected instead of silently rewritten.**

The save path is much stronger than the rest of the application. Fractal owns the files, locks, hashes, and atomic replacement. Amanite has one buffer per path, queued saves, conflict detection, and local recovery drafts. That is a solid base.

The immediate data-integrity gates from this review have been addressed. Folder deletion now uses Fractal's transaction, malformed and incompatible native documents cannot enter a destructive edit path, move rewrites refresh clean open buffers, and corrupt catalog entries no longer hide healthy projects.

## Structure and maintainability

The ownership split is clear. `useWorkspaceDocuments` owns buffers, draft recovery, autosave, conflict state, and saves. `useFractalSession` owns project commands and snapshots. Both editor groups share buffers, so opening one page twice does not create two competing drafts.

The remaining debt is mostly unfinished boundary work:

- `DocumentBuffer.operation` includes `"load"`, but no code sets that state.
- The backend adapter has grown to one 678-line file. It is still readable, but filesystem mutation policy is now mixed with DTO construction and platform commands.

These are not blockers by themselves. They make the next reliability changes easier to get wrong.

## Correctness and data integrity

### Fixed: folder deletion uses Fractal's transaction

`fractal_delete_folder` now delegates to `Project::delete_folder`, so pages and non-HTML assets are removed under Fractal's lock and recoverable file transaction. A backend integration test exercises the command with a page and an attachment.

### Contained: rich editing cannot silently destroy incompatible source

`cleanEditorHtml` removes attributes from most allowed elements and unwraps elements outside its smaller editor vocabulary (`src/features/editor/components/editorHtml.ts:6-58`). The rich editor calls it during every Lexical change (`HtmlBridgePlugin.tsx:26-31`). The existing test explicitly proves that a class on a paragraph is removed.

Fractal native documents allow ordinary HTML attributes that Lexical does not currently preserve. Amanite now runs the compatibility check before rendering the rich editor. Affected pages open in a protected, non-editable state and their source remains untouched.

The remaining feature debt is true lossless editing for those attributes and nodes. Until that exists, protection is the correct integrity behavior.

### Fixed: malformed native pages cannot crash the edit path

Fractal can open an invalid native document so that validation can report it. Amanite then renders it as a rich document. `readEditablePage` falls back to `<p></p>` when the native root is missing, but `writeEditableBody` throws when the user edits (`src/features/editor/components/pageSource.ts:9-40`).

Malformed native documents now show an invalid-document state and do not mount the rich editor. Unit coverage includes a missing doctype, marker, and document root.

### Medium: “Replace disk” cannot restore a page deleted externally

Polling reports a missing page as a conflict (`useProjectFilePolling.ts:31-40`), but the conflict UI offers “Replace disk”. The unconditional write still calls Fractal's `write_page`, which requires the page to exist. The button therefore fails for the exact “removed from disk” case.

Smallest fix: offer “Recreate page” for a missing target, or make the backend distinguish create-or-replace from replace-existing.

### Fixed: Fractal page moves reconcile open buffers

Fractal rewrites backlinks when a page moves. Amanite renames and reloads the moved buffer, but does not reload other open buffers whose files Fractal changed (`src/features/workspace/components/Workspace.tsx:221-229`). Hash polling eventually marks them conflicted, so this is unlikely to silently overwrite a rewrite, but the UI can show old links until polling catches up and then force a manual reload.

After a successful Fractal move, Amanite compares the returned page hashes with every open buffer and reloads clean buffers whose files were rewritten. A concurrently edited buffer is marked conflicted instead of overwritten. This applies to moves performed through Amanite/Fractal; manual file-manager moves remain handled by normal external-change polling.

## Tests and verification

The checks that passed:

- `pnpm test`: 36 tests in 11 files.
- `pnpm run build`: production TypeScript and Vite build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 5 tests passed.
- `pnpm run tauri:webdriver:doctor`: passed.
- `pnpm run tauri:webdriver:smoke`: passed against the real Tauri app, including save, split groups, external conflict detection, reload, and draft recovery.
- `git diff --check`: passed.

The confidence is still narrower than the green numbers suggest. Backend coverage now includes transactional folder deletion and catalog isolation, but there are no integration tests for page moves, imports, recovery transactions, symlink failures, or permission failures. There is no CI configuration, and the WebDriver smoke is a manual command rather than a required check.

## Failure handling and operability

The save failure behavior is good: failed saves leave the buffer dirty, expose an error, and block close/project mutation through `saveAll`. Polling failures now appear as a five-second top-right notice with a cooldown, while conditional saves remain the second line of defense.

Project catalog scanning now isolates bad entries. Healthy projects remain available and the start screen reports how many entries were skipped.

Import cleanup is best effort. If writing imported HTML fails and the rollback delete also fails, the command reports only the import error and can leave an orphan page (`src-tauri/src/lib.rs:501-504`).

## Performance

The current bundle is reasonable. The initial JavaScript chunk is 234.65 kB raw, 72.21 kB gzip. The 472.68 kB workspace/editor chunk loads after a project opens, and Vite emits no large-chunk warning.

The likely startup costs are elsewhere:

- The start screen loads Google Fonts before the app module (`index.html:15-19`). Offline or slow network access can delay the webview startup path.
- Listing projects opens and scans every project just to build summaries (`src-tauri/src/lib.rs:111-152`). This will get slower as the library grows.
- Every open, save, search, and three-second polling check reopens Fractal and scans/parses the whole project (`src-tauri/src/lib.rs:158-223`, `394-405`). This is fine for small projects and the wrong scaling shape for large ones.
- Each rich-editor change serializes the whole Lexical document, cleans it, rebuilds the complete HTML document, and causes several full-document parses for counts, outline, and rendering. Large documents and embedded base64 images will eventually make typing and autosave expensive.

For the app's current scale, I would not optimize this blindly. First measure a release build with 1, 10, 100, and 1,000 pages. The current WebDriver checks use a debug Tauri binary, so they are not a release-startup benchmark.

## Security and trust boundaries

Iframe previews are sandboxed without script execution, and Fractal's conditional writes prevent ordinary external edits from being overwritten silently. Those are good choices.

Native rich-editor anchors are now always intercepted. Internal links stay in Amanite, `http`, `https`, and `mailto` links use the explicit external-opening path, and active or local schemes such as `javascript:`, `data:`, and `file:` are rejected. Raw preview links use the same allowlist. The iframe sandbox was already present, but it did not cover anchors rendered directly inside the main rich-editor webview.

`csp` is still `null` in `src-tauri/tauri.conf.json`. That is not the current data-integrity problem, but it removes a useful defense if another rendering path or plugin is added later.

## What Amanite does well

- Files remain the source of truth. There is no second durable page database to drift.
- Fractal provides atomic writes, project locks, exact content hashes, and recoverable file transactions.
- Amanite queues saves per path and flushes edits received during an in-flight write.
- Conflicts are surfaced instead of overwritten silently.
- Recovery drafts contain complete HTML and are cleared only after a confirmed write.
- The real desktop smoke path is broad enough to catch regressions in the main workspace flow.

## What was not verified

- Release AppImage startup and installation behavior.
- Windows or macOS behavior.
- Large projects and very large documents.
- Screen-reader output and complete keyboard focus behavior.
- Actual native shutdown behavior across repeated runs. One smoke shutdown printed `free(): corrupted unsorted chunks` while still exiting successfully; the app log only contained GTK theme warnings, so this needs a repeatable native-runtime investigation before treating it as an Amanite defect.
