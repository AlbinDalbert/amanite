# Amanite code roast

Reviewed 2026-08-26. This review includes the current worktree, including the uncommitted changes in `README.md`, `src-tauri/capabilities/default.json`, and `src/app/App.tsx`. No `CONTEXT.md` exists.

## Verdict

**Tag line: The save path is careful. The edges still leak state.**

Amanite has a good core design for a small local editor. Fractal remains the file owner. Open documents have one buffer per path. Conditional writes, recovery drafts, and the real desktop smoke path are all better than the usual editor prototype.

The weak spots are concrete, not architectural doom. Page moves do not use Fractal's normalized destination, external links can be mistaken for local pages, and Borealis has search semantics that differ between saved and dirty pages. I would keep building on this code, but I would fix those before calling the workspace reliable.

## Structure and maintainability

The ownership split is mostly right. `useWorkspaceDocuments` owns buffers and persistence. `useFractalSession` owns the project snapshot and commands. The two editor groups share buffers instead of inventing a second draft for the same file. That is the right amount of machinery for two panes.

The Tauri adapter is now a large mixed-responsibility file. `src-tauri/src/lib.rs` contains the AI protocol, project catalog scanning, filesystem policy, Fractal commands, platform file-manager launching, and tests. It is still readable, so I would not split it into a framework for the sake of symmetry. Split the AI commands or filesystem helpers when the next change needs them.

### Low: dead loading state in document buffers

`DocumentBuffer.operation` permits `"load"` in `src/features/workspace/documents/documentBuffers.ts`, but loading is tracked by `loadingPaths` and no code assigns the `load` value. This gives future code a state that cannot occur.

Smallest fix: remove the unused variant. Keep `loadingPaths` as the one loading state owner.

## Correctness and data integrity

### Medium: page moves can leave tabs pointing at a path that Fractal never created

The backend and Fractal normalize destinations. A native move from `index.fractal.html` to `notes/today` creates `notes/today.fractal.html`; a raw move gets `.html`. The UI still uses the raw input in `Workspace.tsx:252-254`:

```text
renameGroupTab(path, destination)
renameDocument(path, destination)
reloadDocument(destination)
```

The result can be a tab with no buffer and a buffer under a path absent from `project.pages`. The same problem applies to an input beginning with `pages/`, which Fractal strips as a project-relative convenience.

Smallest fix: return the canonical changed path from `fractal_move_page`, then use that value for groups, buffers, drafts, and reloads. Add tests for omitted suffixes and the `pages/` prefix.

### Medium: an external link can be hijacked by a page with the same path

`resolveEditorLinkTarget` first honors Fractal's internal metadata, but if the metadata says `external` it falls through to generic URL resolution. A link such as `https://example.com/notes` becomes workspace navigation when the project contains `notes` as a page. `RichDocumentEditor.tsx:48-59` contains the fallback.

Smallest fix: when Fractal has classified the href, return `null` for external, fragment, broken, and non-HTML file targets. Use the generic fallback only when metadata is absent or stale in a way that still proves the link is relative.

### Medium: Borealis searches saved and dirty pages with different rules

`src/lib/ai/workspaceTools.ts:115-130` merges Fractal search results with a local search for dirty buffers. Fractal matches all whitespace-separated terms in title and text. The dirty-buffer branch searches for the whole query as one substring and also searches the path, which Fractal does not. It can therefore remove a saved match after an edit, or return a dirty path that the saved search would not return.

This produces plausible but incomplete AI answers. The tests cover reading dirty content, not search.

Smallest fix: use one shared term matcher for both branches. Either make both sides search paths or remove path matching from the dirty branch, then add tests for two-term queries and edits that remove a saved match.

### Medium: "Replace disk" cannot repair a page deleted outside Amanite

Polling correctly marks a missing page as a conflict, but the conflict UI still offers `Replace disk`. Force-save calls `writePage`, and Fractal's write requires the page to already exist. The advertised recovery action fails for the missing-file case.

Smallest fix: label this case `Recreate page` and provide a create-or-replace command, or make the backend distinguish a missing target before showing the action.

### Medium: import is a two-step mutation with an orphan window

`fractal_import_native_page` creates a valid empty page, then writes the imported source. A crash or failed cleanup between those operations leaves the generated page behind even though the import reports failure. The rollback at `src-tauri/src/lib.rs:785-787` is best effort and its error is discarded.

Smallest fix: add a Fractal operation that validates and creates the page in one locked transaction. Until then, report a cleanup failure and the orphan path instead of hiding it.

## Failure handling and operability

The normal save failure path is good. Failed conditional writes leave the buffer dirty, conflicts are visible, and `saveAll` blocks close and project mutations. Polling errors also get a visible notice instead of disappearing into a console.

### Low: raw preview accumulates document event handlers

`RenderedHtmlPage` adds `click` and `keydown` handlers inside every iframe load at lines 54-80, but its cleanup only removes the iframe's `load` handler at line 92. When the same preview reloads, old handlers remain attached to the iframe document. They retain stale page metadata and navigation callbacks.

Smallest fix: keep the two handler functions in named variables and remove them in the effect cleanup, or replace the document listeners with one delegated handler owned by the frame.

### Low: Borealis has no conversation size limit

Every request sends the complete `conversationRef`, and every tool round appends more messages. A long session eventually sends a request too large for the selected model or spends most of its time resending old text. There is no cancellation or trim path in `AiChat.tsx:59-92`.

Smallest fix: cap retained turns or characters and show a deliberate "start a new chat" state when the cap is reached. Do not add a general memory system until this limit is measured.

### Low: folder creation bypasses the Fractal mutation boundary

`fractal_create_folder` opens a project, drops the project lock, then calls `fs::create_dir_all` directly at `src-tauri/src/lib.rs:793-807`. A concurrent folder delete or project mutation can race with it. The path is also checked lexically, not canonically, so a symlink below `pages/` can send the directory creation outside the project.

Smallest fix: give folder creation the same lock and containment check as other mutations. If Fractal has no folder-create method, add the smallest adapter helper rather than making raw filesystem writes another persistence path.

## Security and trust boundaries

The good news is that the dangerous parts are mostly constrained. Raw previews and native iframe nodes use a sandbox without script permission. External link handling allows only `http`, `https`, and `mailto`. AI page reads are limited to paths present in the current project catalog. The desktop app does not pretend to provide a remote authorization boundary.

### Medium: the AI API key is stored as plaintext webview storage

`useAiSettings` serializes the endpoint, model, and API key together in `localStorage` at `src/app/useAiSettings.ts:35`. Anyone who gets access to the app's webview profile, or any future script injection in the app origin, can read the key. This matters for users connecting a paid cloud endpoint, even though local server use is also supported.

Smallest fix: store the key in the platform keychain and keep only a reference in settings. If that is too much for this release, do not persist the key and say so in the settings UI.

### Low: CSP is disabled

`src-tauri/tauri.conf.json:26` sets `csp` to `null`. There is no demonstrated exploit in the current UI, but this removes a useful barrier around future frontend changes and injected markup.

Smallest fix: add the narrowest CSP that matches the built app, fonts, Tauri IPC, and sandboxed previews. Test it in the desktop smoke path rather than adding a permissive policy just to silence the finding.

## Tests and verification

Checks run:

- `pnpm test`: 46 tests passed in 13 files.
- `pnpm run build`: passed. Vite warns that the workspace chunk is 566.94 kB raw and 178.88 kB gzip.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 7 tests passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: failed on a formatting difference in the assistant-message validation block.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: failed on `items_after_test_module` and `large_enum_variant`.
- `pnpm run tauri:webdriver:doctor`: passed.
- `pnpm run tauri:webdriver:smoke`: passed through the full desktop flow, including saves, Borealis panes, conflicts, and draft recovery. The process then printed `free(): corrupted unsorted chunks` during shutdown. The app log only contained GTK theme warnings, so the native shutdown problem is not yet pinned to Amanite.
- `git diff --check`: passed.

The suite gives useful confidence around pure editor logic, save queues, path helpers, and the main desktop path. It does not cover the move normalization bug, external-link collision, AI search merge, import rollback, symlink handling, permissions, or the close path changed in the current worktree. There is no CI configuration, so these checks are not enforced anywhere.

Smallest verification fix: add focused tests for the five correctness cases above, make formatting and Clippy pass, then put the existing commands into one CI job. Measure the large workspace chunk before splitting it. It may be acceptable for a small app, but the warning should be a conscious choice.

## What Amanite does well

- Fractal files stay the durable source of truth.
- Conditional writes and content hashes protect ordinary external edits.
- One buffer per path prevents split panes from creating competing drafts.
- Recovery drafts contain complete HTML and clear only after a confirmed write.
- Rich editing protects incompatible native documents instead of silently rewriting them.
- The desktop smoke script exercises more than a screenshot. It checks actual save, navigation, conflict, split-pane, and recovery behavior.

## What was not verified

- Release AppImage installation and startup.
- Windows and macOS behavior.
- Large projects and very large documents.
- Screen-reader output and complete keyboard focus behavior.
- Repeatable cause of the native shutdown allocator error.
- Whether the current custom close and destroy flow behaves correctly with dirty pages in a packaged release build.
